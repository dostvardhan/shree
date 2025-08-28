// backend/server.js
// Shree Drive Backend — Netlify Identity + Google Drive (dual-issuer ready)

try { require('dotenv').config(); } catch (_) {
  console.log('dotenv not loaded (Render uses process.env)');
}

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { google } = require('googleapis');

const app = express();

// ---------- CORS ----------
function parseOrigins(val) {
  if (!val) return true; // reflect requesting origin (development-friendly)
  const list = val.split(',').map(s => s.trim()).filter(Boolean);
  return function (origin, cb) {
    if (!origin) return cb(null, true);
    if (list.includes(origin)) return cb(null, true);
    return cb(new Error('CORS not allowed from ' + origin), false);
  };
}

app.use(cors({
  origin: parseOrigins(process.env.ALLOWED_ORIGIN),
  methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type','X-NI-Issuer'],
  exposedHeaders: ['Content-Length','Last-Modified','Content-Type','Content-Disposition'],
  credentials: false,
  maxAge: 86400,
  optionsSuccessStatus: 204,
}));
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- Boot logs ----------
console.log('🚀 Server booting…');
console.log('NETLIFY_IDENTITY_ISSUER =', process.env.NETLIFY_IDENTITY_ISSUER || '(not set)');
console.log('ALLOWED_ORIGIN =', process.env.ALLOWED_ORIGIN || '(reflect)');
console.log('DRIVE_FOLDER_ID =', process.env.DRIVE_FOLDER_ID || '(root)');
console.log('MAKE_PUBLIC =', process.env.MAKE_PUBLIC || 'false');

// ---------- Google OAuth2 + Drive ----------
function getOAuth2Client() {
  const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, REFRESH_TOKEN } = process.env;
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !REFRESH_TOKEN) {
    throw new Error('Google OAuth env missing: CLIENT_ID/CLIENT_SECRET/REDIRECT_URI/REFRESH_TOKEN');
  }
  const oAuth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oAuth2.setCredentials({ refresh_token: REFRESH_TOKEN });
  return oAuth2;
}
function getDrive() {
  return google.drive({ version: 'v3', auth: getOAuth2Client() });
}

// ---------- Identity Issuer helpers (DUAL-ISSUER) ----------
const ALLOWED_ISSUERS = [
  (process.env.NETLIFY_IDENTITY_ISSUER || '').trim(),
  'https://shreshthapushkar.com/.netlify/identity',
  'https://shreshthapushkar.netlify.app/.netlify/identity',
].filter(Boolean);

// Header/env fallback (legacy)
function getIssuerFromRequest(req) {
  const hdr = (req.headers['x-ni-issuer'] || '').trim();
  return hdr || (process.env.NETLIFY_IDENTITY_ISSUER || '').trim();
}

// Prefer token.iss if it matches allowed; else fallback to header/env list
function pickIssuerForToken(token, fallback) {
  try {
    const decoded = jwt.decode(token, { complete: true });
    const iss = decoded?.payload?.iss;
    if (iss && ALLOWED_ISSUERS.includes(iss)) return iss;
  } catch (_) {}
  return fallback || ALLOWED_ISSUERS[0];
}

// Cache JWKS clients per issuer
const jwksCache = new Map();
function getJWKS(issuer) {
  if (jwksCache.has(issuer)) return jwksCache.get(issuer);
  const client = jwksClient({
    jwksUri: `${issuer}/.well-known/jwks.json`,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000,
    timeout: 8000,
  });
  jwksCache.set(issuer, client);
  return client;
}

// ---------- Auth middleware ----------
function authMiddleware(req, res, next) {
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Missing Bearer token' });

  const fallbackIssuer = getIssuerFromRequest(req);
  const ISSUER = pickIssuerForToken(token, fallbackIssuer);
  if (!ISSUER) return res.status(500).json({ ok: false, error: 'Issuer not configured' });

  const client = getJWKS(ISSUER);
  const getKey = (header, cb) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return cb(err);
      cb(null, key.getPublicKey());
    });
  };

  jwt.verify(
    token,
    getKey,
    { algorithms: ['RS256'], issuer: ISSUER, ignoreExpiration: false },
    (err, decoded) => {
      if (err) return res.status(401).json({ ok: false, error: 'JWT verify failed', detail: err.message });
      req.user = decoded;
      next();
    }
  );
}

// ---------- Multer (in-memory) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ---------- Utils ----------
function bufferToStream(buffer) {
  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
async function ensurePublic(drive, fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch (e) {
    console.warn('ensurePublic warn:', e.message || e);
  }
}
const fileFields = 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink';

// ---------- Probes ----------
app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/diag', async (req, res) => {
  try {
    const drive = getDrive();
    const about = await drive.about.get({ fields: 'user(displayName,permissionId)' });
    res.json({
      ok: true,
      issuerEnv: process.env.NETLIFY_IDENTITY_ISSUER || null,
      user: about.data.user,
      folder: process.env.DRIVE_FOLDER_ID || null,
      time: new Date().toISOString(),
      allowedIssuers: ALLOWED_ISSUERS,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- API: List ----------
app.get('/list', authMiddleware, async (req, res) => {
  try {
    const drive = getDrive();
    const folderId = process.env.DRIVE_FOLDER_ID || null;

    let q = 'trashed = false';
    if (folderId) q = `'${folderId}' in parents and ${q}`;

    const resp = await drive.files.list({
      q,
      fields: `files(${fileFields}),nextPageToken`,
      orderBy: 'createdTime desc',
      pageSize: 100,
    });

    res.json({ ok: true, files: resp.data.files || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- API: Upload ----------
app.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'file is required (multipart/form-data)' });

    const drive = getDrive();
    const folderId = process.env.DRIVE_FOLDER_ID || null;

    const requestBody = {
      name: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      ...(folderId ? { parents: [folderId] } : {}),
    };

    const media = {
      mimeType: req.file.mimetype || 'application/octet-stream',
      body: bufferToStream(req.file.buffer),
    };

    const created = await drive.files.create({
      requestBody,
      media,
      fields: fileFields,
    });

    const makePublic = String(process.env.MAKE_PUBLIC || '').toLowerCase() === 'true';
    if (makePublic) {
      await ensurePublic(drive, created.data.id);
      const fetched = await drive.files.get({ fileId: created.data.id, fields: fileFields });
      return res.json({ ok: true, file: fetched.data });
    }

    res.json({ ok: true, file: created.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Shree Drive listening on :${PORT}`);
});
