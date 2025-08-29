// server.js — Private-only Google Drive uploader + viewer (JWT-gated)
// Requirements: Node 18+, render/web service. Env vars set in dashboard.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// ---------- CORS ----------
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use((req, res, next) => {
  res.header('Vary', 'Origin');
  next();
});
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);            // curl / health checks
    const ok = ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN;
    cb(ok ? null : new Error('CORS: origin not allowed: ' + origin), ok);
  },
  methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Type', 'Content-Length', 'Accept-Ranges', 'Content-Range'],
  maxAge: 86400,
}));
app.options('*', cors()); // preflight

// ---------- Google Drive OAuth2 ----------
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// ---------- Upload (multer) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// ---------- Netlify Identity JWT (dual-issuer) ----------
const ISS1 = (process.env.NETLIFY_ISSUER_1 || '').replace(/\/$/, '');
const ISS2 = (process.env.NETLIFY_ISSUER_2 || '').replace(/\/$/, '');
const AUD  = (process.env.NETLIFY_JWT_AUD || '').trim();

function jwksUriForIssuer(iss) {
  const base = iss.replace(/\/$/, '');
  return `${base}/.well-known/jwks.json`;
}

const jwksClients = {};
function getClientForIssuer(iss) {
  const key = iss.replace(/\/$/, '');
  if (!jwksClients[key]) {
    jwksClients[key] = jwksClient({
      jwksUri: jwksUriForIssuer(key),
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return jwksClients[key];
}

async function verifyNetlifyJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No bearer token');
  }
  const token = authHeader.split(' ')[1];
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.payload) throw new Error('Invalid token format');

  const { iss, aud } = decoded.payload;
  const cleanIss = (iss || '').replace(/\/$/, '');
  if (![ISS1, ISS2].includes(cleanIss)) throw new Error(`Bad issuer: ${iss}`);
  if (AUD && aud && aud !== AUD) throw new Error(`Bad audience: ${aud}`);

  const client = getClientForIssuer(cleanIss);
  const key = await client.getSigningKey(decoded.header.kid);
  const signingKey = key.getPublicKey();

  const verified = jwt.verify(token, signingKey, {
    algorithms: ['RS256'],
    issuer: [ISS1, ISS2],
    audience: AUD || undefined,
    clockTolerance: 60, // 60s skew
  });
  return verified; // includes email, sub, etc.
}

// ---------- Routes ----------

// Root: simple health HTML (so "Cannot GET /" na aaye)
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
  <meta charset="utf-8">
  <title>shree-drive</title>
  <pre>{
  "ok": true,
  "service": "shree-drive",
  "time": "${new Date().toISOString()}"
}</pre>`);
});

// OAuth helper (optional)
app.get('/auth/url', (_req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly'
  ];
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  res.json({ ok: true, url });
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oAuth2Client.getToken(code);
    res.json({ ok: true, tokens });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Diagnostics
app.get('/diag', async (req, res) => {
  const out = { ok: true, steps: {} };
  try {
    // Identity check (if token provided)
    try {
      const identity = await verifyNetlifyJWT(req.headers.authorization || '');
      out.steps.identity = { ok: true, email: identity.email || null, iss: identity.iss };
    } catch (e) {
      out.steps.identity = { ok: false, note: 'Send Authorization: Bearer <jwt> to test', error: e.message };
    }
    // JWKS keys
    try {
      const c1 = ISS1 ? await getClientForIssuer(ISS1).getKeys() : [];
      const c2 = ISS2 ? await getClientForIssuer(ISS2).getKeys() : [];
      out.steps.jwks = { ok: true, issuers: [ISS1, ISS2].filter(Boolean), k1: c1.length, k2: c2.length };
    } catch (e) {
      out.steps.jwks = { ok: false, error: e.message };
    }
    // Drive about
    try {
      const about = await drive.about.get({ fields: 'user(displayName,permissionId),storageQuota(usage,limit)' });
      out.steps.drive = { ok: true, user: about.data.user, quota: about.data.storageQuota };
    } catch (e) {
      out.steps.drive = { ok: false, error: e.message };
    }

    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, out });
  }
});

// Auth guard
async function requireAuth(req, res, next) {
  try {
    const claims = await verifyNetlifyJWT(req.headers.authorization || '');
    req.user = claims;
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: 'Unauthorized: ' + e.message });
  }
}

// List files (private)
app.get('/list', requireAuth, async (_req, res) => {
  try {
    const folder = process.env.DRIVE_FOLDER_ID || '';
    const q = folder ? `'${folder}' in parents and trashed = false` : 'trashed = false';
    const r = await drive.files.list({
      q,
      orderBy: 'createdTime desc',
      fields: 'files(id,name,mimeType,size,createdTime,modifiedTime)',
      pageSize: 100,
    });
    res.json({ ok: true, files: r.data.files || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Upload (keeps file PRIVATE — no "anyone with link" permission created)
app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
    const fileMeta = {
      name: req.file.originalname,
      parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined,
    };
    const media = { mimeType: req.file.mimetype, body: Buffer.from(req.file.buffer) };
    const create = await drive.files.create({ resource: fileMeta, media, fields: 'id,name,mimeType,size' });
    res.json({ ok: true, file: create.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Secure file stream (supports Range for videos)
// If client sends "Range", we forward it to Drive and mirror headers/status.
app.get('/file/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const range = req.headers.range;

    // Get metadata for correct headers
    const meta = await drive.files.get({ fileId: id, fields: 'name,mimeType,size' });
    const mime = meta.data.mimeType || 'application/octet-stream';
    const totalSize = parseInt(meta.data.size || '0', 10) || undefined;

    // Prepare headers
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${meta.data.name || id}"`);

    const requestOpts = {
      responseType: 'stream',
      headers: {}
    };
    if (range) {
      requestOpts.headers.Range = range; // e.g. "bytes=0-"
    }

    const gRes = await drive.files.get({ fileId: id, alt: 'media' }, requestOpts);

    // Mirror partial content headers if present
    const status = gRes.status || (range ? 206 : 200);
    if (gRes.headers && gRes.headers['content-range']) {
      res.setHeader('Content-Range', gRes.headers['content-range']);
    }
    if (gRes.headers && gRes.headers['content-length']) {
      res.setHeader('Content-Length', gRes.headers['content-length']);
    } else if (!range && totalSize) {
      res.setHeader('Content-Length', totalSize);
    }

    res.status(status);
    gRes.data.on('error', () => res.status(500).end());
    gRes.data.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('server on :' + PORT));
