// server.js
// Shree Drive Backend — Netlify Identity + Google Drive
// Packages: express, cors, multer, googleapis, jsonwebtoken, jwks-rsa

// ---------- Boot & Env ----------
require('dotenv').config(); // harmless on Render if .env absent

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- CORS ----------
const parseOrigins = (val) => {
  if (!val) return true; // reflect request origin
  const arr = val.split(',').map(s => s.trim()).filter(Boolean);
  return function(origin, cb) {
    if (!origin) return cb(null, true);
    if (arr.includes(origin)) return cb(null, true);
    return cb(null, false);
  };
};

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

// ---------- Helpful boot logs ----------
console.log('🚀 Server booting…');
console.log('NETLIFY_IDENTITY_ISSUER =', process.env.NETLIFY_IDENTITY_ISSUER || '(not set)');
console.log('ALLOWED_ORIGIN =', process.env.ALLOWED_ORIGIN || '(reflect)');
console.log('DRIVE_FOLDER_ID =', process.env.DRIVE_FOLDER_ID || '(root)');
console.log('MAKE_PUBLIC =', process.env.MAKE_PUBLIC || 'false');

// ---------- Health/Diag ----------
app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/diag', async (req, res) => {
  try {
    const auth = getOAuth2Client();
    const drive = google.drive({ version: 'v3', auth });
    const about = await drive.about.get({ fields: 'user(displayName,permissionId)' });
    res.json({
      ok: true,
      issuerEnv: process.env.NETLIFY_IDENTITY_ISSUER || null,
      user: about.data.user,
      folder: process.env.DRIVE_FOLDER_ID || null,
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- Netlify Identity JWT Verify ----------
const getIssuer = (req) => {
  const fromEnv = (process.env.NETLIFY_IDENTITY_ISSUER || '').trim();
  const fromHeader = (req.headers['x-ni-issuer'] || '').trim();
  // env wins; header is fallback if env absent
  return fromEnv || fromHeader;
};

const clientsCache = new Map();
const getJWKSClient = (issuer) => {
  if (clientsCache.has(issuer)) return clientsCache.get(issuer);
  const client = jwksClient({
    jwksUri: `${issuer}/.well-known/jwks.json`,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000,
    timeout: 8000,
  });
  clientsCache.set(issuer, client);
  return client;
};

function authMiddleware(req, res, next) {
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Missing Bearer token' });

  const ISSUER = getIssuer(req);
  if (!ISSUER) return res.status(500).json({ ok: false, error: 'Issuer not configured' });

  const client = getJWKSClient(ISSUER);

  const getKey = (header, callback) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  };

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['RS256'],
      issuer: ISSUER,
      // Netlify Identity tokens often have no audience we control; skip audience check.
      ignoreExpiration: false,
    },
    (err, decoded) => {
      if (err) {
        return res.status(401).json({ ok: false, error: 'JWT verify failed', detail: String(err.message || err) });
      }
      req.user = decoded;
      next();
    }
  );
}

// ---------- Google OAuth2 (Refresh Token flow) ----------
function getOAuth2Client() {
  const {
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI,
    REFRESH_TOKEN
  } = process.env;

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !REFRESH_TOKEN) {
    throw new Error('Google OAuth env missing: CLIENT_ID/CLIENT_SECRET/REDIRECT_URI/REFRESH_TOKEN');
  }

  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
  return oAuth2Client;
}

function getDrive() {
  const auth = getOAuth2Client();
  return google.drive({ version: 'v3', auth });
}

// ---------- Multer (in-memory) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// ---------- Helpers ----------
async function ensurePublic(drive, fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  } catch (e) {
    // ignore if already public or insufficient permission error
    console.warn('ensurePublic warn:', e.message || e);
  }
}

function driveFields(fields) {
  return fields || 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink';
}

// ---------- Routes (protected) ----------

// List files in DRIVE_FOLDER_ID (or root)
app.get('/list', authMiddleware, async (req, res) => {
  try {
    const drive = getDrive();
    const folderId = process.env.DRIVE_FOLDER_ID || null;

    let q = "trashed = false";
    if (folderId) q = `'${folderId}' in parents and ${q}`;

    const resp = await drive.files.list({
      q,
      fields: `files(${driveFields()}),nextPageToken`,
      orderBy: 'createdTime desc',
      pageSize: 100,
      supportsAllDrives: false,
    });

    res.json({ ok: true, files: resp.data.files || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Upload file to Drive
app.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'file is required (multipart/form-data)' });

    const drive = getDrive();
    const folderId = process.env.DRIVE_FOLDER_ID || null;

    const fileMeta = {
      name: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      ...(folderId ? { parents: [folderId] } : {}),
    };

    const media = {
      mimeType: req.file.mimetype || 'application/octet-stream',
      body: BufferToStream(req.file.buffer),
    };

    const created = await drive.files.create({
      requestBody: fileMeta,
      media,
      fields: driveFields(),
      supportsAllDrives: false,
    });

    const makePublic = String(process.env.MAKE_PUBLIC || '').toLowerCase() === 'true';
    if (makePublic) {
      await ensurePublic(drive, created.data.id);
      // re-fetch links to ensure webViewLink/webContentLink present
      const fetched = await drive.files.get({
        fileId: created.data.id,
        fields: driveFields(),
      });
      return res.json({ ok: true, file: fetched.data });
    }

    res.json({ ok: true, file: created.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- Utils ----------
function BufferToStream(buffer) {
  const { Readable } = require('stream');
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Shree Drive listening on :${PORT}`);
});
