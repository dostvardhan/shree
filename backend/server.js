// backend/server.js
// Node + Express backend for Shreshtha site
// Requires: express, cookie-parser, express-session, axios, jsonwebtoken, multer, googleapis
// Install locally: npm i express cookie-parser express-session axios jsonwebtoken multer googleapis

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

// ----------------- ENV / CONFIG -----------------
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
  DRIVE_LIST_MODE = 'drive',   // <== NEW: control gallery listing mode
  STATIC_DIR = 'private'
} = process.env;

// Validate required envs (Auth0)
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
  console.error('❌ Missing required env vars:', missing.join(', '));
  process.exit(1);
}

const isDriveConfigured =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN && GOOGLE_DRIVE_FOLDER_ID;

// ----------------- MIDDLEWARE -----------------
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

// ----------------- STATIC FILES -----------------
const publicDir = path.join(__dirname, STATIC_DIR);
app.use(express.static(publicDir));

// ----------------- AUTH HELPERS -----------------
const allowedSet = new Set(ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean));
function createSessionToken(payload) {
  return jwt.sign(payload, SESSION_SECRET, { algorithm: 'HS256', expiresIn: '12h' });
}
function verifySessionToken(token) {
  try { return jwt.verify(token, SESSION_SECRET); } catch { return null; }
}
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies['shree_session'];
  if (!token) return res.redirect('/index.html');
  const user = verifySessionToken(token);
  if (!user) {
    res.clearCookie('shree_session');
    return res.redirect('/index.html');
  }
  req.user = user;
  next();
}

// ----------------- AUTH0 LOGIN FLOW -----------------
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
    const userEmail = decoded && decoded.email;
    if (!userEmail) return res.status(400).send('No email in token');

    if (allowedSet.size > 0 && !allowedSet.has(userEmail))
      return res.status(403).send('User not allowed');

    const sessionToken = createSessionToken({
      email: userEmail,
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
    console.error('Auth callback error:', err.response ? err.response.data : err.message);
    return res.status(500).send('Authentication failed');
  }
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('shree_session');
  const returnTo = encodeURIComponent(FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`);
  res.redirect(`https://${AUTH0_DOMAIN}/v2/logout?client_id=${AUTH0_CLIENT_ID}&returnTo=${returnTo}`);
});

// ----------------- PROTECTED PAGES -----------------
const protectedPages = [
  '/life.html','/upload.html','/gallery.html',
  '/photo1.html','/photo2.html','/photo3.html','/photo4.html','/photo5.html',
  '/photo6.html','/photo7.html','/photo8.html','/photo9.html'
];
app.get(protectedPages, requireAuth, (req, res) =>
  res.sendFile(path.join(publicDir, req.path))
);

// ----------------- GOOGLE DRIVE -----------------
let driveClient;
if (isDriveConfigured) {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  console.log('✅ Google Drive client configured.');
} else {
  console.warn('⚠️ Google Drive env vars missing — uploads to Drive will not work.');
}

// ----------------- LOCAL PHOTOS JSON -----------------
const PHOTOS_JSON = path.join(__dirname, 'photos.json');
const uploadDir = os.tmpdir();

async function ensurePhotosJson() {
  try { await access(PHOTOS_JSON, fs.constants.F_OK); }
  catch { await writeFile(PHOTOS_JSON, JSON.stringify([]), 'utf8'); }
}
async function readPhotos() {
  await ensurePhotosJson();
  return JSON.parse(await readFile(PHOTOS_JSON, 'utf8') || '[]');
}
async function writePhotos(arr) {
  await writeFile(PHOTOS_JSON, JSON.stringify(arr, null, 2), 'utf8');
}

// ----------------- MULTER UPLOAD -----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// ----------------- API: UPLOAD -----------------
app.post('/api/upload', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (!driveClient) {
      // fallback: local save
      const destDir = path.join(publicDir, 'photos');
      await fs.promises.mkdir(destDir, { recursive: true });
      const dest = path.join(destDir, path.basename(req.file.path));
      await fs.promises.copyFile(req.file.path, dest);
      await unlink(req.file.path).catch(() => {});
      const photos = await readPhotos();
      const entry = {
        id: `local:${path.basename(dest)}`,
        name: path.basename(dest),
        caption: req.body.caption || '',
        uploadedBy: req.user.email,
        uploadedAt: new Date().toISOString(),
        url: `/photos/${path.basename(dest)}`
      };
      photos.unshift(entry);
      await writePhotos(photos);
      return res.json({ ok: true, entry });
    }

    // upload to Drive
    const fileMetadata = { name: req.file.originalname };
    if (GOOGLE_DRIVE_FOLDER_ID) fileMetadata.parents = [GOOGLE_DRIVE_FOLDER_ID];
    const media = { mimeType: req.file.mimetype, body: fs.createReadStream(req.file.path) };
    const createRes = await driveClient.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id,name,mimeType'
    });
    const fileId = createRes.data.id;

    if ((MAKE_PUBLIC + '').toLowerCase() === 'true') {
      try {
        await driveClient.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (e) {
        console.warn('Could not set public permission:', e.message || e);
      }
    }

    await unlink(req.file.path).catch(() => {});

    const photos = await readPhotos();
    const entry = {
      id: fileId,
      name: createRes.data.name,
      mimeType: createRes.data.mimeType,
      caption: req.body.caption || '',
      uploadedBy: req.user.email,
      uploadedAt: new Date().toISOString()
    };
    photos.unshift(entry);
    await writePhotos(photos);

    return res.json({ ok: true, entry });
  } catch (err) {
    console.error('Upload error:', err.message || err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// ----------------- API: LIST -----------------
app.get('/api/list', requireAuth, async (req, res) => {
  try {
    if (DRIVE_LIST_MODE === 'drive' && driveClient) {
      // Directly list Drive folder
      const resp = await driveClient.files.list({
        q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,createdTime,properties)'
      });
      const list = (resp.data.files || []).map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        caption: (f.properties && f.properties.caption) || '',
        uploadedAt: f.createdTime
      }));
      return res.json(list);
    } else {
      const photos = await readPhotos();
      return res.json(photos);
    }
  } catch (err) {
    console.error('/api/list error:', err.message || err);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

// ----------------- API: STREAM FILE -----------------
app.get('/api/file/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).send('Missing id');

  if (id.startsWith('local:')) {
    const filename = id.replace('local:', '');
    const filePath = path.join(publicDir, 'photos', filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    return res.sendFile(filePath);
  }

  if (!driveClient) return res.status(500).send('Drive not configured');

  try {
    const meta = await driveClient.files.get({ fileId: id, fields: 'mimeType' });
    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    const driveRes = await driveClient.files.get({ fileId: id, alt: 'media' }, { responseType: 'stream' });
    driveRes.data.pipe(res);
  } catch (err) {
    console.error('/api/file error:', err.message || err);
    res.status(500).send('Stream error');
  }
});

// ----------------- DIAG -----------------
app.get('/api/diag', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ----------------- ROOT -----------------
app.get('/', (req, res) => res.redirect('/index.html'));

// ----------------- START -----------------
const listenPort = process.env.PORT ? Number(process.env.PORT) : Number(PORT || 4000);
const server = app.listen(listenPort, () => {
  console.log(`✅ Server listening on port ${listenPort} - NODE_ENV=${NODE_ENV}`);
  console.log(`Drive configured: ${isDriveConfigured ? 'yes' : 'no'}`);
  console.log(`DRIVE_LIST_MODE=${DRIVE_LIST_MODE}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}. Closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
