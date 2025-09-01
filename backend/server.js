// server.js — Shree Drive (PRIVATE MODE, JWKS SKIPPED)

const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const {
  PORT = 3000,
  ALLOWED_ORIGIN,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,
  MAKE_PUBLIC = 'false',
} = process.env;

// CORS
app.use((req, res, next) => {
  if (ALLOWED_ORIGIN) res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Identity JWT verify (decode only, no JWKS)
function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'No token' });

    // Just decode without verifying
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) return res.status(401).json({ error: 'Invalid token' });

    req.user = decoded.payload;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized: ' + e.message });
  }
}

// Google Drive client
const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });

// Helpers
async function ensurePublic(id) {
  if (String(MAKE_PUBLIC).toLowerCase() !== 'true') return;
  try {
    await drive.permissions.create({ fileId: id, requestBody: { role: 'reader', type: 'anyone' } });
  } catch {}
}

// Routes
app.get('/health', (req,res)=>res.json({ ok:true }));
app.get('/diag', async (req, res) => {
  try {
    const about = await drive.about.get({ fields: 'user(displayName,permissionId)' });
    res.json({ ok:true, user:about.data.user, folder:DRIVE_FOLDER_ID||null, makePublic:MAKE_PUBLIC });
  } catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error:'No file' });
    if (!DRIVE_FOLDER_ID) return res.status(500).json({ error:'DRIVE_FOLDER_ID not set' });

    const name = `${Date.now()}_${(req.file.originalnam_
