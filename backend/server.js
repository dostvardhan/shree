// server.js — Shree Drive (PRIVATE MODE, JWKS SKIPPED)

const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { Readable } = require('stream');   // ✅ stream import

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
if (REFRESH_TOKEN) {
  oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
}
const drive = google.drive({ version: 'v3', auth: oauth2 });

// Helpers
async function ensurePublic(id) {
  if (String(MAKE_PUBLIC).toLowerCase() !== 'true') return;
  try {
    await drive.permissions.create({
      fileId: id,
      requestBody: { role: 'reader', type: 'anyone' }
    });
  } catch {}
}

// Root route (for Render health check)
app.get('/', (req,res)=>res.json({ ok:true, msg:'Shree Drive backend running' }));

// Health check route
app.get('/health', (req,res)=>res.json({ ok:true }));

// Diagnostic
app.get('/diag', async (req, res) => {
  try {
    const about = await drive.about.get({ fields: 'user(displayName,permissionId)' });
    res.json({
      ok:true,
      user:about.data.user,
      folder:DRIVE_FOLDER_ID||null,
      makePublic:MAKE_PUBLIC
    });
  } catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

// Upload (✅ stream fix applied)
app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error:'No file' });
    if (!DRIVE_FOLDER_ID) return res.status(500).json({ error:'DRIVE_FOLDER_ID not set' });

    const name = `${Date.now()}_${(req.file.originalname||'upload').replace(/[^\w.\-]/g,'_')}`;
    const stream = Readable.from(req.file.buffer);   // ✅ convert buffer to stream

    const r = await drive.files.create({
      requestBody: { name, parents:[DRIVE_FOLDER_ID] },
      media: { mimeType: req.file.mimetype, body: stream },
      fields: 'id,name,mimeType,createdTime'
    });

    await ensurePublic(r.data.id);
    res.json({
      ok:true,
      id:r.data.id,
      name:r.data.name,
      mimeType:r.data.mimeType,
      createdTime:r.data.createdTime
    });
  } catch(e){ 
    res.status(500).json({ ok:false, error:e.message }); 
  }
});

// List files
app.get('/list', requireAuth, async (req, res) => {
  try {
    if (!DRIVE_FOLDER_ID) return res.status(500).json({ error:'DRIVE_FOLDER_ID not set' });
    const pageSize = Math.min(Number(req.query.pageSize || 100), 1000);
    const r = await drive.files.list({
      q: `'${DRIVE_FOLDER_ID}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize,
      fields: 'files(id,name,mimeType,createdTime)'
    });
    res.json(r.data.files || []);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// Fetch file
app.get('/file/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (DRIVE_FOLDER_ID) {
      const meta = await drive.files.get({ fileId: id, fields: 'parents,mimeType,name' });
      const ok = (meta.data.parents || []).includes(DRIVE_FOLDER_ID);
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
      res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.data.name)}"`);
    }
    res.setHeader('Cache-Control', 'private, max-age=60');
    const stream = await drive.files.get({ fileId: id, alt:'media' }, { responseType: 'stream' });
    stream.data.on('error', () => res.status(500).end());
    stream.data.pipe(res);
  } catch(e){ res.status(404).json({ error:'Not found' }); }
});

// ===== OAuth routes for generating refresh token =====

// Step 1: generate Google login URL (manual build)
app.get('/auth/url', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.metadata.readonly'
  ].join(' ');

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;

  res.json({ url });
});

// Step 2: handle callback, exchange code for tokens
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  try {
    const { tokens } = await oauth2.getToken(code);
    res.json({ ok: true, tokens });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Start server
app.listen(PORT, ()=> console.log('Server on :' + PORT));
