// server.js (FULL) - CommonJS - place at backend/server.js
// Requires: express, cookie-parser, express-session, axios, jsonwebtoken, multer, googleapis
// Make sure package.json contains these deps and Render env vars are set.

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');
const util = require('util');
const multer = require('multer');
const { google } = require('googleapis');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);

const app = express();

// ----------------- ENV/CONFIG -----------------
const {
  PORT = 4000,
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
  NODE_ENV = 'production',
  STATIC_DIR = 'private' // folder name where your static html lives (backend/private)
} = process.env;

// Helpful env presence logging for deploy troubleshooting
function envPresenceMap() {
  const map = {
    AUTH0_DOMAIN: !!AUTH0_DOMAIN,
    AUTH0_CLIENT_ID: !!AUTH0_CLIENT_ID,
    AUTH0_CLIENT_SECRET: !!AUTH0_CLIENT_SECRET,
    AUTH0_REDIRECT_URI: !!AUTH0_REDIRECT_URI,
    AUTH0_AUDIENCE: !!AUTH0_AUDIENCE,
    SESSION_SECRET: !!SESSION_SECRET
  };
  return map;
}

if (
  !AUTH0_DOMAIN ||
  !AUTH0_CLIENT_ID ||
  !AUTH0_CLIENT_SECRET ||
  !AUTH0_REDIRECT_URI ||
  !AUTH0_AUDIENCE ||
  !SESSION_SECRET
) {
  console.error('❌ Missing required env vars (Auth0 + SESSION_SECRET). Exiting.');
  console.error('Env presence map:', envPresenceMap());
  process.exit(1);
}

// ----------------- MIDDLEWARE -----------------
app.use(express.json());
app.use(cookieParser());

// IMPORTANT: session cookie settings compatible with Auth0 redirects (cross-site).
// In production we must set secure=true and sameSite='none' so browser accepts cookie after Auth0 redirect.
app.use(
  session({
    name: 'shree_session',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: NODE_ENV === 'production', // true in prod (HTTPS)
      sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// ----------------- HEALTH (very fast) -----------------
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
});

// ----------------- STATIC FILES -----------------
const publicDir = path.join(__dirname, STATIC_DIR); // defaults to backend/private
app.use(express.static(publicDir));

// ----------------- HELPERS / AUTH -----------------
const allowedSet = new Set(ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean));

function createSessionToken(payload) {
  return jwt.sign(payload, SESSION_SECRET, { algorithm: 'HS256', expiresIn: '12h' });
}
function verifySessionToken(token) {
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch (err) {
    return null;
  }
}
function requireAuth(req, res, next) {
  const token = req.cookies['shree_session'];
  if (!token) return res.redirect('/index.html');
  const user = verifySessionToken(token);
  if (!user) {
    res.clearCookie('shree_session');
    return res.redirect('/index.html');
  }
  req.user = user;
  next();
}

// ----------------- AUTH0 Regular Web App Flow -----------------
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
  const url = `https://${AUTH0_DOMAIN}/authorize?${params.toString()}`;
  res.redirect(url);
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
    }, { headers: { 'Content-Type': 'application/json' }});

    const { id_token } = tokenResp.data;
    const decoded = jwt.decode(id_token);
    const userEmail = decoded && decoded.email;
    if (!userEmail) return res.status(400).send('No email in token');

    if (allowedSet.size > 0 && !allowedSet.has(userEmail)) {
      return res.status(403).send('User not allowed');
    }

    const sessionToken = createSessionToken({
      email: userEmail,
      name: decoded.name || '',
      sub: decoded.sub
    });

    res.cookie('shree_session', sessionToken, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    // redirect to life page after login
    return res.redirect('/life.html');
  } catch (err) {
    console.error('Auth callback error:', err.response ? err.response.data : err.message);
    return res.status(500).send('Authentication failed');
  }
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('shree_session');
  const returnTo = encodeURIComponent(FRONTEND_ORIGIN || `https://${req.hostname}`);
  const logoutUrl = `https://${AUTH0_DOMAIN}/v2/logout?client_id=${AUTH0_CLIENT_ID}&returnTo=${returnTo}`;
  res.redirect(logoutUrl);
});

// ----------------- PROTECTED PAGES -----------------
const protectedPages = [
  '/life.html','/upload.html','/gallery.html',
  '/photo1.html','/photo2.html','/photo3.html','/photo4.html','/photo5.html','/photo6.html','/photo7.html','/photo8.html','/photo9.html'
];
app.get(protectedPages, requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, req.path));
});

// ----------------- GOOGLE DRIVE & MULTER SETUP -----------------
const PHOTOS_JSON = path.join(__dirname, 'photos.json'); // metadata file
const uploadDir = os.tmpdir();
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const name = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

// Drive OAuth client using refresh token (optional)
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.warn('⚠️ Google Drive env vars missing - uploads will fail until provided.');
}
const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// ----------------- PHOTOS.JSON UTILITIES -----------------
async function ensurePhotosJson() {
  try {
    await readFile(PHOTOS_JSON, 'utf8');
  } catch (err) {
    await writeFile(PHOTOS_JSON, JSON.stringify([]), 'utf8');
  }
}
async function readPhotos() {
  await ensurePhotosJson();
  const raw = await readFile(PHOTOS_JSON, 'utf8');
  return JSON.parse(raw || '[]');
}
async function writePhotos(arr) {
  await writeFile(PHOTOS_JSON, JSON.stringify(arr, null, 2), 'utf8');
}

// ----------------- API: UPLOAD -----------------
app.post('/api/upload', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded (field name must be "photo")' });
    }

    const caption = (req.body.caption || '').trim();
    const uploader = req.user && req.user.email ? req.user.email : 'unknown';
    const tmpPath = req.file.path;
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;

    // If Google Drive configured, upload there. Otherwise store locally under private/uploads (fallback)
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
      const fileMetadata = { name: originalName };
      if (GOOGLE_DRIVE_FOLDER_ID) fileMetadata.parents = [GOOGLE_DRIVE_FOLDER_ID];

      const media = { mimeType, body: fs.createReadStream(tmpPath) };

      const createRes = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, mimeType'
      });

      const fileId = createRes.data.id;

      if ((MAKE_PUBLIC + '').toLowerCase() === 'true') {
        try {
          await drive.permissions.create({
            fileId,
            requestBody: { role: 'reader', type: 'anyone' }
          });
        } catch (permErr) {
          console.warn('Could not set public permission:', permErr && permErr.message ? permErr.message : permErr);
        }
      }

      const photos = await readPhotos();
      const entry = {
        id: fileId,
        name: createRes.data.name || originalName,
        mimeType: createRes.data.mimeType || mimeType,
        caption,
        uploadedBy: uploader,
        uploadedAt: new Date().toISOString()
      };
      photos.unshift(entry);
      await writePhotos(photos);

      try { await unlink(tmpPath); } catch (e) { /* ignore */ }

      return res.json({ ok: true, entry });
    } else {
      // Fallback: move file into private/uploads and add to photos.json with pseudo-id = filename
      const destDir = path.join(publicDir, 'uploads');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destName = path.basename(tmpPath);
      const destPath = path.join(destDir, destName);
      fs.renameSync(tmpPath, destPath);

      const entry = {
        id: `local:${destName}`,
        name: originalName,
        mimeType,
        caption,
        uploadedBy: uploader,
        uploadedAt: new Date().toISOString(),
        localPath: `/uploads/${destName}`
      };
      const photos = await readPhotos();
      photos.unshift(entry);
      await writePhotos(photos);

      return res.json({ ok: true, entry });
    }
  } catch (err) {
    console.error('Upload error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Upload failed', details: err && err.message });
  }
});

// ----------------- API: LIST -----------------
app.get('/api/list', requireAuth, async (req, res) => {
  try {
    const photos = await readPhotos();
    return res.json(photos);
  } catch (err) {
    console.error('/api/list error:', err);
    return res.status(500).json({ error: 'Failed to read photos' });
  }
});

// ----------------- API: STREAM FILE -----------------
app.get('/api/file/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).send('Missing file id');

  try {
    // local stored file (fallback) uses id starting with "local:"
    if (id.startsWith('local:')) {
      const filename = id.slice('local:'.length);
      const localPath = path.join(publicDir, 'uploads', filename);
      if (!fs.existsSync(localPath)) return res.status(404).send('Not found');
      return res.sendFile(localPath);
    }

    // otherwise treat id as Google Drive file id
    const meta = await drive.files.get({ fileId: id, fields: 'id, name, mimeType, size' });
    const mimeType = meta.data.mimeType || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);

    const driveRes = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'stream' });

    driveRes.data
      .on('end', () => {
        // done
      })
      .on('error', (err) => {
        console.error('Stream error from Drive:', err);
        if (!res.headersSent) res.status(500).send('Stream error');
      })
      .pipe(res);
  } catch (err) {
    console.error('/api/file/:id error:', err && (err.message || err.response && err.response.data) ? (err.message || err.response.data) : err);
    return res.status(500).send('Failed to stream file');
  }
});

// ----------------- SIMPLE DIAG -----------------
app.get('/api/diag', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ----------------- START SERVER -----------------
const listenPort = process.env.PORT ? Number(process.env.PORT) : Number(PORT || 4000);
const server = app.listen(listenPort, () => {
  console.log(`✅ Server listening on port ${listenPort} - NODE_ENV=${NODE_ENV}`);
  console.log(`Static dir: ${publicDir}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`Received ${signal}. Closing server...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Force exit.');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
