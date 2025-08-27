// backend/server.js
// Node/Express + Google Drive (OAuth refresh token) + Netlify Identity JWT verify
// Routes: /health, /diag, /auth/url, /oauth2callback, /list, /upload, /file/:id (proxy)

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { google } = require('googleapis');

const app = express();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// ---- ENV ----
const PORT = process.env.PORT || 3000;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MAKE_PUBLIC = String(process.env.MAKE_PUBLIC || '').toLowerCase() === 'true';
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || null;

// Netlify Identity (GoTrue) JWKS — override with JWT_JWKS if needed
// By default we point to your domain's Identity JWKS.
const DEFAULT_JWKS = 'https://shreshthapushkar.com/.netlify/identity/.well-known/jwks.json';
const JWKS_URI = process.env.JWT_JWKS || DEFAULT_JWKS;

// ---- CORS ----
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/postman
    if (ALLOWED.length === 0 || ALLOWED.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: false,
}));
app.use(express.json());

// ---- Google OAuth2 ----
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// We use a long-lived refresh token for server-to-server calls
if (process.env.REFRESH_TOKEN) {
  oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
} else {
  console.warn('WARNING: REFRESH_TOKEN not set — Drive API calls will fail.');
}

const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// ---- JWT Verify (Netlify Identity) ----
const jwksClient = jwksRsa({
  jwksUri: JWKS_URI,
  cache: true,
  rateLimit: true,
});

function getKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

async function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        ignoreExpiration: false,
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer (.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: 'missing bearer token' });
    const token = m[1];
    const decoded = await verifyToken(token);
    req.user = decoded; // { sub, email, ... }
    next();
  } catch (e) {
    console.error('Auth error:', e && e.message);
    res.status(401).json({ ok: false, error: 'invalid token' });
  }
}

// ---- Helpers ----
function driveQueryForFolder(folderId) {
  if (!folderId) return "trashed = false";
  return `'${folderId}' in parents and trashed = false`;
}

// ---- Routes ----
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/diag', async (req, res) => {
  try {
    const about = await drive.about.get({ fields: 'user(displayName, permissionId)' });
    res.json({ ok: true, user: about.data.user });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'drive auth failed', details: e?.message });
  }
});

// OPTIONAL: If you still use interactive OAuth (usually for getting the first refresh token)
app.get('/auth/url', (req, res) => {
  const scopes = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly'];
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  });
  res.json({ ok: true, url });
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const code = req.query.code;
    const { tokens } = await oAuth2Client.getToken(code);
    res.json({ ok: true, tokens });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'oauth exchange failed' });
  }
});

// LIST files (protected)
app.get('/list', requireAuth, async (req, res) => {
  try {
    let pageToken = null;
    const files = [];
    do {
      const { data } = await drive.files.list({
        q: driveQueryForFolder(DRIVE_FOLDER_ID),
        fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 100,
        pageToken,
      });
      (data.files || []).forEach(f => files.push(f));
      pageToken = data.nextPageToken;
    } while (pageToken);

    res.json({ ok: true, files });
  } catch (e) {
    console.error('LIST error', e?.response?.data || e);
    res.status(500).json({ ok: false, error: 'list failed' });
  }
});

// UPLOAD file (protected)
app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });

    const fileMeta = {
      name: req.file.originalname,
      parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined,
    };

    const created = await drive.files.create({
      requestBody: fileMeta,
      media: { mimeType: req.file.mimetype, body: Buffer.from(req.file.buffer) },
      fields: 'id, name, mimeType, size, webViewLink',
    });

    // Optionally make public
    if (MAKE_PUBLIC) {
      try {
        await drive.permissions.create({
          fileId: created.data.id,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (e) {
        // ignore if already public or permission issue
      }
    }

    res.json({ ok: true, file: created.data });
  } catch (e) {
    console.error('UPLOAD error', e?.response?.data || e);
    res.status(500).json({ ok: false, error: 'upload failed' });
  }
});

// === NEW: PUBLIC image/file proxy (no auth) ===
// <img src="https://your-backend/file/:id">
app.get('/file/:id', async (req, res) => {
  try {
    const fileId = req.params.id;

    // (Optional) Safety: ensure file is in our folder
    if (DRIVE_FOLDER_ID) {
      try {
        const meta = await drive.files.get({ fileId, fields: 'parents' });
        const parents = meta.data.parents || [];
        if (!parents.includes(DRIVE_FOLDER_ID)) {
          return res.status(403).json({ ok: false, error: 'forbidden: outside folder' });
        }
      } catch (e) {
        // if file not found:
        if (e?.code === 404) return res.status(404).end('not found');
        // otherwise continue; we’ll try to stream and handle errors below
      }
    }

    // Get mime for correct Content-Type
    let mimeType = 'application/octet-stream';
    try {
      const meta2 = await drive.files.get({ fileId, fields: 'mimeType, name' });
      if (meta2?.data?.mimeType) mimeType = meta2.data.mimeType;
    } catch (_) {}

    // Stream file bytes
    const dl = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1h cache

    dl.data
      .on('error', (e) => {
        console.error('stream error', e?.message || e);
        if (!res.headersSent) res.status(500).end('stream error');
      })
      .pipe(res);
  } catch (e) {
    // Handle known googleapis errors
    const code = e?.code || e?.response?.status || 500;
    if (!res.headersSent) {
      res.status(code).json({ ok: false, error: 'failed to fetch file' });
    }
  }
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
