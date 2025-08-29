// server.js
// Node/Express backend for Google Drive Upload + List with Netlify Identity (JWT RS256)

const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { google } = require('googleapis');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB

// ----- ENV -----
const {
  PORT = 3000,
  ALLOWED_ORIGIN,
  IDENTITY_ISSUER, // https://shreshthapushkar.com/.netlify/identity
  JWKS_URI,        // https://shreshthapushkar.com/.netlify/identity/.well-known/jwks.json
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,    // e.g. https://shree-drive.onrender.com/oauth2callback (not actually used at runtime)
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,
  MAKE_PUBLIC = 'true',
} = process.env;

// ----- CORS -----
app.use((req, res, next) => {
  if (ALLOWED_ORIGIN) res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ----- Netlify Identity JWT verify (RS256 via JWKS) -----
const jwks = jwksClient({ jwksUri: JWKS_URI, cache: true, cacheMaxAge: 10 * 60 * 1000, rateLimit: true });

function getKey(header, cb) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return cb(err);
    const signingKey = key.getPublicKey();
    cb(null, signingKey);
  });
}

function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'No token' });

    jwt.verify(token, getKey, { issuer: IDENTITY_ISSUER, algorithms: ['RS256'] }, (err, decoded) => {
      if (err) return res.status(401).json({ error: `Unauthorized: ${err.message}` });
      req.user = decoded;
      next();
    });
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ----- Google Drive client -----
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// Helpers
const asPublicLink = (id) => `https://drive.google.com/uc?id=${id}`; // good for <img src=...>
async function ensurePublic(id) {
  if (String(MAKE_PUBLIC).toLowerCase() !== 'true') return;
  try {
    // make file readable by anyone (no error if already public)
    await drive.permissions.create({ fileId: id, requestBody: { role: 'reader', type: 'anyone' } });
  } catch (_) {}
}

// ----- Routes -----
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/diag', async (req, res) => {
  try {
    const about = await drive.about.get({ fields: 'user(displayName,permissionId), storageQuota' });
    res.json({
      ok: true,
      user: about.data.user,
      folder: DRIVE_FOLDER_ID ? DRIVE_FOLDER_ID : null,
      makePublic: MAKE_PUBLIC,
      issuer: IDENTITY_ISSUER,
      jwks: JWKS_URI,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Upload to Google Drive
app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    if (!DRIVE_FOLDER_ID) return res.status(500).json({ error: 'DRIVE_FOLDER_ID not set' });

    const originalName = req.file.originalname || 'upload';
    const safeName = `${Date.now()}_${originalName}`.replace(/[^\w.\-]/g, '_');

    const file = await drive.files.create({
      requestBody: {
        name: safeName,
        parents: [DRIVE_FOLDER_ID],
      },
      media: { mimeType: req.file.mimetype, body: Buffer.from(req.file.buffer) },
      fields: 'id, name, mimeType, webViewLink, webContentLink, createdTime',
    });

    const id = file.data.id;
    await ensurePublic(id);

    res.json({
      ok: true,
      id,
      name: file.data.name,
      mimeType: file.data.mimeType,
      createdTime: file.data.createdTime,
      webViewLink: file.data.webViewLink,
      webContentLink: file.data.webContentLink,
      directLink: asPublicLink(id),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// List files in folder (newest first)
app.get('/list', requireAuth, async (req, res) => {
  try {
    if (!DRIVE_FOLDER_ID) return res.status(500).json({ error: 'DRIVE_FOLDER_ID not set' });

    const pageSize = Math.min(Number(req.query.pageSize || 100), 1000);
    const r = await drive.files.list({
      q: `'${DRIVE_FOLDER_ID}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize,
      fields: 'files(id,name,mimeType,createdTime,webViewLink,webContentLink,thumbnailLink)',
    });

    const files = (r.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdTime: f.createdTime,
      webViewLink: f.webViewLink,
      webContentLink: f.webContentLink,
      directLink: asPublicLink(f.id),
      thumbnailLink: f.thumbnailLink,
    }));

    res.json(files);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server on :${PORT}`));
