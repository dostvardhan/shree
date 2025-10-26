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

// Promisify fs for async/await
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);
const access = util.promisify(fs.access);

const app = express();

// ✅ Disable caching globally
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ✅ Environment Variables
const {
  PORT = 4000,
  NODE_ENV = 'production',

  // Auth0
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET,
  AUTH0_REDIRECT_URI,
  AUTH0_AUDIENCE,
  SESSION_SECRET,
  FRONTEND_ORIGIN = '',
  ALLOWED_USERS = '',

  // Google Drive
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_DRIVE_FOLDER_ID,
  MAKE_PUBLIC = 'false',

  // Static / Folders
  STATIC_DIR = 'private',
  DRIVE_LIST_MODE = 'drive',
  PHOTOS_JSON = path.join(__dirname, 'photos.json')
} = process.env;

// ✅ Check Required ENV Vars
const required = {
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET,
  AUTH0_REDIRECT_URI,
  AUTH0_AUDIENCE,
  SESSION_SECRET
};
const missing = Object.keys(required).filter(k => !required[k]);
if (missing.length > 0) {
  console.error('❌ Missing required env vars:', missing.join(', '));
  process.exit(1);
}

// ✅ Check if Google Drive is usable
const isDriveConfigured =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN && GOOGLE_DRIVE_FOLDER_ID;

// ✅ Middleware for cookies + JSON
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
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// ✅ Static Files Directory Setup
let publicDir = path.join(__dirname, STATIC_DIR || 'private');
if (!fs.existsSync(publicDir)) {
  console.warn(`⚠️ Static dir "${STATIC_DIR}" not found — using backend root`);
  publicDir = __dirname;
}
const uploadsDir = path.join(__dirname, 'uploads');
fs.promises.mkdir(uploadsDir, { recursive: true }).catch(() => {});
console.log('✅ Serving static files from:', publicDir);

// ✅ Helpers for Session Tokens
const allowedSet = new Set(ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean));

const createSessionToken = payload =>
  jwt.sign(payload, SESSION_SECRET, { algorithm: 'HS256', expiresIn: '12h' });

const verifySessionToken = token => {
  try { return jwt.verify(token, SESSION_SECRET); }
  catch { return null; }
};

function requireAuth(req, res, next) {
  const token = req.cookies?.['shree_session'];

  // helper: does the client expect JSON / is this an API call?
  const wantsJson =
    req.path.startsWith('/api/') ||
    req.xhr === true ||
    (req.headers.accept && req.headers.accept.includes('application/json'));

  if (!token) {
    if (wantsJson) return res.status(401).json({ error: 'unauthenticated' });
    return res.redirect('/index.html');
  }

  const user = verifySessionToken(token);
  if (!user) {
    res.clearCookie('shree_session');
    if (wantsJson) return res.status(401).json({ error: 'invalid_session' });
    return res.redirect('/index.html');
  }

  req.user = user;
  next();
}


// ✅ AUTH — LOGIN
app.get('/auth/login', (req, res) => {
  const state = Math.random().toString(36).substring(2);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH0_CLIENT_ID,
    redirect_uri: AUTH0_REDIRECT_URI,
    scope: 'openid profile email',
    audience: AUTH0_AUDIENCE,
    state
  });
  return res.redirect(`https://${AUTH0_DOMAIN}/authorize?${params.toString()}`);
});

// ✅ AUTH — CALLBACK
app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing auth code');

    const tokenRes = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: AUTH0_CLIENT_ID,
      client_secret: AUTH0_CLIENT_SECRET,
      code,
      redirect_uri: AUTH0_REDIRECT_URI
    }, { headers: { 'Content-Type': 'application/json' } });

    const idToken = tokenRes.data.id_token;
    const decoded = jwt.decode(idToken);
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
    console.error('❌ Auth callback error:', err?.response?.data || err);
    return res.status(500).send('Authentication failed');
  }
});

// ✅ AUTH — LOGOUT
app.get('/auth/logout', (req, res) => {
  try { req.session?.destroy(() => {}); } catch {}
  try {
    res.clearCookie('shree_session', {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'lax'
    });
  } catch {}

  const returnTo = encodeURIComponent(
    FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`
  );

  return res.redirect(
    `https://${AUTH0_DOMAIN}/v2/logout?client_id=${AUTH0_CLIENT_ID}&returnTo=${returnTo}`
  );
});
/* ============================
   ✅ GOOGLE DRIVE SETUP
================================ */
let driveClient;
if (isDriveConfigured) {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  console.log("✅ Google Drive connected");
} else {
  console.warn("⚠️ Google Drive not configured — using photos.json fallback");
}

/* ============================
   ✅ Photos JSON Fallback Helpers
================================ */
async function ensurePhotosJson(filePath) {
  try { await access(filePath, fs.constants.F_OK); }
  catch { await writeFile(filePath, JSON.stringify([]), 'utf8'); }
}
async function readPhotos(filePath) {
  await ensurePhotosJson(filePath);
  const data = await readFile(filePath, 'utf8');
  return JSON.parse(data || '[]');
}
async function writePhotos(filePath, arr) {
  await writeFile(filePath, JSON.stringify(arr, null, 2), 'utf8');
}

/* ============================
   ✅ Multer Setup (for photo uploads)
================================ */
const tempDir = os.tmpdir(); // OS temporary directory
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, tempDir),
  filename: (_, file, cb) => {
    // Prevent whitespace issues in file name
    const safeName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB max
});

/* ============================
   ✅ Protected HTML pages
   -> Only logged-in users can view
================================ */
const protectedPages = [
  '/welcome.html',
  '/life.html',
  '/upload.html',
  '/gallery.html',
  '/photo1.html', '/photo2.html', '/photo3.html', '/photo4.html',
  '/photo5.html', '/photo6.html', '/photo7.html', '/photo8.html', '/photo9.html'
];
app.get(protectedPages, requireAuth, (req, res) => {
  const filePath = path.join(publicDir, req.path);
  if (!fs.existsSync(filePath)) {
    console.warn("❌ Protected file not found:", filePath);
    return res.status(404).send('Not found');
  }
  return res.sendFile(filePath);
});

/* ============================
   ✅ API: Basic check
================================ */
app.get('/api/upload', (req, res) => {
  return res.json({ ok: true, msg: 'Upload endpoint working. Use POST to upload.' });
});

/* ============================
   ✅ API: POST /api/upload
   -> Auth required, uploads image to Google Drive or local fallback
================================ */
app.post('/api/upload', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    const caption = (req.body.caption || '').trim();
    const uploader = req.user?.email || 'unknown';

    // ✅ If Drive is fully configured → upload to Drive
    if (driveClient) {
      const meta = {
        name: req.file.originalname,
        description: caption,
        appProperties: { caption, uploadedBy: uploader },
        parents: GOOGLE_DRIVE_FOLDER_ID ? [GOOGLE_DRIVE_FOLDER_ID] : undefined
      };

      const media = {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path)
      };

      const resp = await driveClient.files.create({
        requestBody: meta,
        media,
        fields: 'id,name,mimeType,createdTime'
      });
      const fileId = resp.data.id;

      // Optional public link
      if ((MAKE_PUBLIC + '').toLowerCase() === 'true') {
        await driveClient.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' }
        }).catch(() => {});
      }

      // Remove temp file
      await unlink(req.file.path).catch(() => {});

      // Save to fallback JSON (so gallery still has order/name info)
      const photos = await readPhotos(PHOTOS_JSON);
      photos.unshift({
        id: fileId,
        name: resp.data.name,
        mimeType: resp.data.mimeType,
        caption,
        uploadedBy: uploader,
        uploadedAt: resp.data.createdTime
      });
      await writePhotos(PHOTOS_JSON, photos);

      return res.json({ ok: true, entry: { id: fileId, caption } });
    }

    // ✅ Fallback (Local upload if Drive not configured)
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    const destination = path.join(uploadsDir, req.file.filename);
    await fs.promises.copyFile(req.file.path, destination);
    await unlink(req.file.path).catch(() => {});

    const photos = await readPhotos(PHOTOS_JSON);
    photos.unshift({
      id: 'local:' + req.file.filename,
      name: req.file.filename,
      caption,
      uploadedBy: uploader,
      uploadedAt: new Date().toISOString()
    });
    await writePhotos(PHOTOS_JSON, photos);

    return res.json({ ok: true, entry: { id: 'local:' + req.file.filename, caption } });
  } catch (err) {
    console.error('❌ Upload error:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

/* ============================
   ✅ API: GET /api/list
   -> Returns list of uploaded photos
================================ */
app.get('/api/list', requireAuth, async (req, res) => {
  try {
    // Prefer listing from Google Drive if available
    if (driveClient && DRIVE_LIST_MODE === 'drive') {
      let query = "trashed = false";
      if (GOOGLE_DRIVE_FOLDER_ID) {
        query += ` and '${GOOGLE_DRIVE_FOLDER_ID}' in parents`;
      }

      const allFiles = [];
      let pageToken = null;
      do {
        const resp = await driveClient.files.list({
          q: query,
          fields: 'nextPageToken, files(id,name,mimeType,description,appProperties,createdTime)',
          pageSize: 50,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });
        allFiles.push(...resp.data.files);
        pageToken = resp.data.nextPageToken;
      } while (pageToken);

      const mapped = allFiles.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        caption: f.appProperties?.caption || f.description || '',
        uploadedBy: f.appProperties?.uploadedBy || '',
        uploadedAt: f.createdTime
      }));

      return res.json(mapped);
    }

    // Otherwise fallback to photos.json
    const photos = await readPhotos(PHOTOS_JSON);
    return res.json(photos);
  } catch (err) {
    console.error('/api/list error:', err);
    return res.status(500).json({ error: 'Failed to list photos' });
  }
});
/* ============================
   ✅ API: GET /api/file/:id
   -> Streams an image either from local uploads or Google Drive
================================ */
app.get('/api/file/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).send('Missing id');

  // Local file case
  if (id.startsWith('local:')) {
    const filename = id.slice('local:'.length);
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    // Inline display
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    return res.sendFile(filePath);
  }

  // Google Drive case
  if (!driveClient) return res.status(500).send('Drive not configured');
  try {
    // fetch metadata for content-type / filename
    const meta = await driveClient.files.get({ fileId: id, fields: 'name,mimeType' });
    const safeName = (meta.data.name || 'file').replace(/["\\]/g, '');
    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);

    const streamRes = await driveClient.files.get(
      { fileId: id, alt: 'media' },
      { responseType: 'stream' }
    );
    streamRes.data.on('error', (e) => {
      console.error('Drive stream error:', e);
      if (!res.headersSent) res.status(500).end('Stream error');
    });
    return streamRes.data.pipe(res);
  } catch (err) {
    console.error('/api/file error:', err?.response?.data || err);
    return res.status(500).send('Stream error');
  }
});

/* ============================
   ✅ Health & Diagnostics
================================ */
app.get('/api/diag', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

/* ============================
   ✅ Root + Static Files
================================ */
app.get('/', (req, res) => res.redirect('/index.html'));
app.use(express.static(publicDir));

/* ============================
   ✅ Start Server
================================ */
const listenPort = Number(process.env.PORT || PORT || 4000);
const server = app.listen(listenPort, '0.0.0.0', () => {
  console.log(`✅ Server listening on ${listenPort} | NODE_ENV=${NODE_ENV}`);
  console.log(`• Static dir: ${publicDir}`);
});

/* ============================
   ✅ Graceful Shutdown
================================ */
function shutdown(signal) {
  console.log(`⚠️ Received ${signal}. Closing server...`);
  server.close(() => {
    console.log('✅ Server closed cleanly.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('⏰ Forcing shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('❌ Unhandled Rejection at:', p, 'reason:', reason);
});
