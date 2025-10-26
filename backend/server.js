// backend/server.js
// Node + Express backend for Shreshtha site

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const util = require('util');
const os = require('os');
const multer = require('multer');
const { google } = require('googleapis');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);
const access = util.promisify(fs.access);

const app = express();

// Disable caching
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma','no-cache');
  res.set('Expires','0');
  res.set('Vary','Cookie');
  next();
});

// -------- ENV CONFIG ----------
const {
  PORT = 4000,
  NODE_ENV = 'production',
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET,
  AUTH0_REDIRECT_URI,
  AUTH0_AUDIENCE,
  SESSION_SECRET,
  FRONTEND_ORIGIN = '',
  ALLOWED_USERS = '',
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_DRIVE_FOLDER_ID,
  MAKE_PUBLIC = 'false',
  STATIC_DIR = 'private',
  DRIVE_LIST_MODE = 'drive',
  PHOTOS_JSON = path.join(__dirname, 'photos.json')
} = process.env;

const required = {
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET,
  AUTH0_REDIRECT_URI,
  AUTH0_AUDIENCE,
  SESSION_SECRET
};
const missing = Object.keys(required).filter(k => !required[k]);
if (missing.length) {
  console.error('❌ Missing env vars:', missing.join(', '));
  process.exit(1);
}

const isDriveConfigured = !!(
  GOOGLE_CLIENT_ID &&
  GOOGLE_CLIENT_SECRET &&
  GOOGLE_REFRESH_TOKEN &&
  GOOGLE_DRIVE_FOLDER_ID
);

// -------- MIDDLEWARE ----------
app.use(express.json());
app.use(cookieParser());
app.use(session({
  name: 'shree_session',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// -------- STATIC PATHS ----------
let publicDir = path.join(__dirname, STATIC_DIR || 'private');
if (!fs.existsSync(publicDir)) {
  console.warn(`⚠️ STATIC_DIR "${STATIC_DIR}" not found, falling back to root.`);
  publicDir = path.join(__dirname);
}
const uploadsDir = path.join(__dirname, 'uploads');
fs.promises.mkdir(uploadsDir, { recursive: true }).catch(()=>{});

console.log("✅ Resolved publicDir:", publicDir);

// -------- AUTH HELPERS ----------
const allowedSet = new Set(ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean));

function createSessionToken(payload) {
  return jwt.sign(payload, SESSION_SECRET, { algorithm: 'HS256', expiresIn: '12h' });
}
function verifySessionToken(token) {
  try { return jwt.verify(token, SESSION_SECRET); }
  catch { return null; }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.['shree_session'];
  if (!token) {
    const wantsJson = req.xhr ||
      (req.headers['accept']?.includes('application/json')) ||
      req.path.startsWith('/api/');
    if (wantsJson) return res.status(401).json({ error: 'unauthenticated' });
    return res.redirect('/index.html');
  }
  const user = verifySessionToken(token);
  if (!user) {
    res.clearCookie('shree_session');
    return res.redirect('/index.html');
  }
  req.user = user;
  next();
}

// -------- AUTH0 LOGIN ----------
app.get('/auth/login', (req, res) => {
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH0_CLIENT_ID,
    redirect_uri: AUTH0_REDIRECT_URI,
    scope: 'openid profile email',
    audience: AUTH0_AUDIENCE,
    state
  });
  res.redirect(`https://${AUTH0_DOMAIN}/authorize?${params.toString()}`);
});

// -------- AUTH0 CALLBACK ----------
app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');

    const tokenResp = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: AUTH0_CLIENT_ID,
      client_secret: AUTH0_CLIENT_SECRET,
      code,
      redirect_uri: AUTH0_REDIRECT_URI
    }, { headers: { 'Content-Type': 'application/json' } });

    const { id_token } = tokenResp.data;
    const decoded = jwt.decode(id_token);
    const email = decoded?.email;
    if (!email) return res.status(400).send('No email in token');

    if (allowedSet.size > 0 && !allowedSet.has(email)) {
      return res.status(403).send('User not allowed');
    }

    const sessionToken = createSessionToken({
      email,
      name: decoded.name || '',
      sub: decoded.sub
    });

    res.cookie('shree_session', sessionToken, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.redirect('/welcome.html');
  } catch (err) {
    console.error('Auth callback error:', err?.response?.data || err);
    res.status(500).send('Authentication failed');
  }
});

// -------- ✅ FIXED AUTH LOGOUT ----------
app.get('/auth/logout', (req, res) => {
  try { req.session?.destroy(() => {}); } catch {}
  try { res.clearCookie('shree_session', { httpOnly: true,_
// -------- GOOGLE DRIVE CONFIG ----------
let driveClient;
if (isDriveConfigured) {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  console.log('✅ Google Drive client configured.');
} else {
  console.warn('⚠️ Google Drive not fully configured. Falling back to local uploads/photos.json.');
}

// -------- FALLBACK photos.json ----------
async function ensurePhotosJson(filePath) {
  try { await access(filePath, fs.constants.F_OK); }
  catch { await writeFile(filePath, JSON.stringify([]), 'utf8'); }
}
async function readPhotos(filePath) {
  await ensurePhotosJson(filePath);
  return JSON.parse(await readFile(filePath, 'utf8') || '[]');
}
async function writePhotos(filePath, arr) {
  await writeFile(filePath, JSON.stringify(arr, null, 2), 'utf8');
}

// -------- MULTER TEMP STORAGE ----------
const tempDir = os.tmpdir();
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// -------- PROTECTED PAGES ----------
const protectedPages = [
  '/life.html','/upload.html','/gallery.html','/welcome.html',
  '/photo1.html','/photo2.html','/photo3.html','/photo4.html',
  '/photo5.html','/photo6.html','/photo7.html','/photo8.html','/photo9.html'
];
app.get(protectedPages, requireAuth, (req, res) => {
  const filePath = path.join(publicDir, req.path);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  return res.sendFile(filePath);
});

// -------- API: UPLOAD ----------
app.get('/api/upload', (req, res) => {
  res.json({ ok: true, msg: 'upload endpoint reachable (GET)' });
});

app.post('/api/upload', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const caption = (req.body.caption || '').trim();
    const uploader = req.user?.email || 'unknown';

    if (driveClient) {
      const fileMetadata = {
        name: req.file.originalname,
        description: caption,
        appProperties: { caption, uploadedBy: uploader },
        parents: GOOGLE_DRIVE_FOLDER_ID ? [GOOGLE_DRIVE_FOLDER_ID] : undefined
      };
      const media = { mimeType: req.file.mimetype, body: fs.createReadStream(req.file.path) };
      const result = await driveClient.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id,name,mimeType,createdTime,appProperties'
      });
      const fileId = result.data.id;

      if ((MAKE_PUBLIC + '').toLowerCase() === 'true') {
        try {
          await driveClient.permissions.create({
            fileId,
            requestBody: { role: 'reader', type: 'anyone' }
          });
        } catch {}
      }

      await unlink(req.file.path).catch(()=>{});

      const photos = await readPhotos(PHOTOS_JSON);
      photos.unshift({
        id: fileId,
        name: result.data.name,
        mimeType: result.data.mimeType,
        caption,
        uploadedBy: uploader,
        uploadedAt: result.data.createdTime
      });
      await writePhotos(PHOTOS_JSON, photos);

      return res.json({ ok: true, entry: { id: fileId, caption } });
    }

    // Fallback to local
    const dest = path.join(uploadsDir, path.basename(req.file.path));
    await fs.promises.copyFile(req.file.path, dest);
    await unlink(req.file.path).catch(()=>{});
    const photos = await readPhotos(PHOTOS_JSON);
    photos.unshift({
      id: 'local:' + path.basename(dest),
      name: path.basename(dest),
      caption,
      uploadedBy: uploader,
      uploadedAt: new Date().toISOString()
    });
    await writePhotos(PHOTOS_JSON, photos);

    res.json({ ok: true, entry: { id: 'local:' + path.basename(dest), caption } });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// -------- API: LIST FILES ----------
app.get('/api/list', requireAuth, async (req, res) => {
  try {
    if (driveClient && DRIVE_LIST_MODE === 'drive') {
      let q = "trashed = false";
      if (GOOGLE_DRIVE_FOLDER_ID) q += ` and '${GOOGLE_DRIVE_FOLDER_ID}' in parents`;

      const files = [];
      let pageToken;
      do {
        const resp = await driveClient.files.list({
          q,
          pageSize: 50,
          fields: 'nextPageToken, files(id,name,mimeType,description,appProperties,createdTime)',
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });
        files.push(...resp.data.files);
        pageToken = resp.data.nextPageToken;
      } while (pageToken);

      const mapped = files.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        caption: f.appProperties?.caption || f.description || '',
        uploadedBy: f.appProperties?.uploadedBy || '',
        uploadedAt: f.createdTime
      }));
      return res.json(mapped);
    }

    const photos = await readPhotos(PHOTOS_JSON);
    res.json(photos);
  } catch (err) {
    console.error('/api/list error:', err);
    res.status(500).json({ error: 'Failed to list' });
  }
});

// -------- API: STREAM FILE ----------
app.get('/api/file/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).send('Missing id');

  if (id.startsWith('local:')) {
    const file = id.replace('local:', '');
    const filePath = path.join(uploadsDir, file);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    res.setHeader('Content-Disposition', `inline; filename="${file}"`);
    return res.sendFile(filePath);
  }

  if (!driveClient) return res.status(500).send('Drive not configured');

  try {
    const meta = await driveClient.files.get({ fileId: id, fields: 'mimeType,name' });
    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${meta.data.name}"`);
    const driveRes = await driveClient.files.get(
      { fileId: id, alt: 'media' },
      { responseType: 'stream' }
    );
    driveRes.data.pipe(res);
  } catch (err) {
    console.error('/api/file error:', err);
    res.status(500).send('Stream error');
  }
});

// -------- DIAG + HEALTH ----------
app.get('/api/diag', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
});

// -------- ROOT ----------
app.get('/', (req, res) => res.redirect('/index.html'));

// -------- STATIC FILES ----------
app.use(express.static(publicDir));

// -------- START SERVER ----------
const listenPort = Number(process.env.PORT || PORT || 4000);
const server = app.listen(listenPort, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${listenPort} | ENV=${NODE_ENV}`);
});

// -------- GRACEFUL SHUTDOWN ----------
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
});
