// server.js
// Express + Google Drive + Netlify Identity (private gallery)

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { google } = require('googleapis');

const app = express();

// ---------- CORS ----------
const ALLOW_ORIGINS = [
  'https://shreshthapushkar.com',
  'https://www.shreshthapushkar.com',
  'http://localhost:8888',
  'http://localhost:5173',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, ALLOW_ORIGINS.includes(origin));
  },
  allowedHeaders: ['Authorization', 'Content-Type', 'X-NI-Issuer'],
  credentials: false,
}));

// ---------- ENV ----------
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,
  NETLIFY_IDENTITY_ISSUER, // optional
} = process.env;

// ---------- Google Drive client ----------
const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// ---------- Robust Netlify Identity verify ----------
const jwksCache = new Map();
function makeJwksClientFor(issuerBase) {
  const base = issuerBase.replace(/\/+$/, '');
  const uri = `${base}/.well-known/jwks.json`;
  if (!jwksCache.has(uri)) {
    jwksCache.set(uri, jwksClient({
      jwksUri: uri,
      cache: true,
      cacheMaxEntries: 10,
      cacheMaxAge: 60 * 60 * 1000,
    }));
  }
  return { client: jwksCache.get(uri), jwksUri: uri };
}

function urlSafeDecodeJwtNoVerify(token) {
  try {
    const part = token.split('.')[1];
    const s = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(s);
  } catch { return null; }
}

async function ensureAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'NO_TOKEN' });

    // 1) Preferred: take issuer from frontend header
    let issuer =
      (req.headers['x-ni-issuer'] && String(req.headers['x-ni-issuer'])) ||
      NETLIFY_IDENTITY_ISSUER ||
      null;

    // 2) If still missing, try to read from token
    if (!issuer) {
      const decoded = urlSafeDecodeJwtNoVerify(token);
      if (decoded?.iss) issuer = decoded.iss;
    }
    if (!issuer) {
      return res.status(401).json({ ok: false, error: 'NO_ISSUER', hint: 'Send X-NI-Issuer header or set NETLIFY_IDENTITY_ISSUER' });
    }

    const { client, jwksUri } = makeJwksClientFor(issuer);

    function getKey(header, cb) {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return cb(err);
        cb(null, key.getPublicKey());
      });
    }

    const decoded = urlSafeDecodeJwtNoVerify(token);
    const verifyOpts = { algorithms: ['RS256'] };
    if (decoded?.iss) verifyOpts.issuer = decoded.iss;

    jwt.verify(token, getKey, verifyOpts, (err, verified) => {
      if (err) {
        console.error('JWT_VERIFY_ERR', err.message, 'JWKS:', jwksUri);
        return res.status(401).json({ ok: false, error: 'invalid token', hint: err.message });
      }
      req.user = verified;
      next();
    });
  } catch (e) {
    console.error('AUTH_MIDDLEWARE_ERR', e?.message);
    res.status(401).json({ ok: false, error: 'AUTH_ERR' });
  }
}

// ---------- Health ----------
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- Diag ----------
app.get('/diag', async (_req, res) => {
  try {
    let driveOk = false, quota = null, user = null;
    try {
      const about = await drive.about.get({ fields: 'user(displayName,emailAddress,permissionId),storageQuota(limit,usage)' });
      driveOk = true;
      quota = about.data?.storageQuota || null;
      user = about.data?.user || null;
    } catch {}
    res.json({
      ok: true,
      user,
      folder: DRIVE_FOLDER_ID || null,
      driveOk,
      quota,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'DIAG_ERR' });
  }
});

// ---------- Multer ----------
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- LIST ----------
app.get('/list', ensureAuth, async (req, res) => {
  try {
    const qParts = [];
    if (DRIVE_FOLDER_ID) qParts.push(`'${DRIVE_FOLDER_ID}' in parents`);
    qParts.push('trashed = false');
    const q = qParts.join(' and ');

    const r = await drive.files.list({
      q,
      pageSize: 200,
      fields: 'files(id,name,mimeType,size,modifiedTime)',
      orderBy: 'modifiedTime desc',
    });

    res.json({ ok: true, files: r.data.files || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'LIST_ERR' });
  }
});

// ---------- UPLOAD ----------
app.post('/upload', ensureAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });

    const fileMetadata = {
      name: req.file.originalname,
      ...(DRIVE_FOLDER_ID ? { parents: [DRIVE_FOLDER_ID] } : {}),
    };
    const media = {
      mimeType: req.file.mimetype,
      body: Buffer.isBuffer(req.file.buffer)
        ? require('stream').Readable.from(req.file.buffer)
        : req.file.stream || req.file.buffer,
    };

    const created = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id,name,mimeType,size,modifiedTime',
    });

    res.json({ ok: true, file: created.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'UPLOAD_ERR' });
  }
});

// ---------- FILE STREAM ----------
app.get('/file/:id', ensureAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const meta = await drive.files.get({
      fileId: id,
      fields: 'name,mimeType,modifiedTime,size',
    });
    const { name, mimeType, modifiedTime, size } = meta.data || {};

    const driveRes = await drive.files.get(
      { fileId: id, alt: 'media' },
      { responseType: 'stream' }
    );

    if (mimeType) res.setHeader('Content-Type', mimeType);
    if (name) res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    if (size) res.setHeader('Content-Length', size);
    if (modifiedTime) res.setHeader('Last-Modified', new Date(modifiedTime).toUTCString());
    res.setHeader('Cache-Control', 'public, max-age=86400');

    driveRes.data.on('error', (e) => {
      console.error('Drive stream error:', e?.message);
      if (!res.headersSent) res.status(502).json({ ok: false, error: 'STREAM_ERROR' });
    });

    driveRes.data.pipe(res)
