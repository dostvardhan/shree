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

  // Static & listing
  STATIC_DIR = 'private',
  DRIVE_LIST_MODE = 'drive', // 'drive' to list from Drive; anything else falls back to photos.json

  // Fallback JSON path (only used if not listing from Drive)
  PHOTOS_JSON = path.join(__dirname, 'photos.json')
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
  !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN && GOOGLE_DRIVE_FOLDER_ID);

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

// ----------------- AUTH0 FLOW -----------------
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

// ----------------- FALLBACK photos.json (only if not listing from Drive) -----------------
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

// ----------------- MULTER UPLOAD -----------------
const uploadDir = os.tmpdir();
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

    const caption = (req.body.caption || '').trim();
    const uploader = (req.user && req.user.email) || 'unknown';

    if (driveClient) {
      // Upload to Drive with caption in metadata
      const fileMetadata = {
        name: req.file.originalname,
        description: caption,    // visible in Drive UI
        appProperties: {         // machine-friendly for our API
          caption,
          uploadedBy: uploader
        }
      };
      if (GOOGLE_DRIVE_FOLDER_ID) fileMetadata.parents = [GOOGLE_DRIVE_FOLDER_ID];

      const media = { mimeType: req.file.mimetype, body: fs.createReadStream(req.file.path) };

      const createRes = await driveClient.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id,name,mimeType,description,appProperties,createdTime'
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

      // cleanup tmp
      await unlink(req.file.path).catch(() => {});

      // Also write to fallback JSON (optional)
      const photos = await readPhotos(PHOTOS_JSON);
      photos.unshift({
        id: fileId,
        name: createRes.data.name,
        mimeType: createRes.data.mimeType,
        caption,
        uploadedBy: uploader,
        uploadedAt: createRes.data.createdTime || new Date().toISOString()
      });
      await writePhotos(PHOTOS_JSON, photos);

      return res.json({ ok: true, entry: { id: fileId, caption } });
    }

    // Fallback: save into public/photos when Drive is not configured
    const destDir = path.join(publicDir, 'photos');
    await fs.promises.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(req.file.path));
    await fs.promises.copyFile(req.file.path, dest);
    await unlink(req.file.path).catch(() => {});
    const photos = await readPhotos(PHOTOS_JSON);
    photos.unshift({
      id: `local:${path.basename(dest)}`,
      name: path.basename(dest),
      caption,
      uploadedBy: uploader,
      uploadedAt: new Date().toISOString(),
      url: `/photos/${path.basename(dest)}`
    });
    await writePhotos(PHOTOS_JSON, photos);
    return res.json({ ok: true, entry: { id: `local:${path.basename(dest)}`, caption } });
  } catch (err) {
    console.error('Upload error:', err && err.response ? err.response.data : err.message || err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// ----------------- API: LIST (Drive-first, reads caption) -----------------
app.get('/api/list', requireAuth, async (req, res) => {
  try {
    if (driveClient && (DRIVE_LIST_MODE + '').toLowerCase() === 'drive') {
      let q = "trashed = false";
      if (GOOGLE_DRIVE_FOLDER_ID) {
        q += ` and '${GOOGLE_DRIVE_FOLDER_ID}' in parents`;
      }

      const files = [];
      let pageToken;
      do {
        const resp = await driveClient.files.list({
          q,
          pageSize: 50,
          fields: 'nextPageToken, files(id,name,mimeType,description,appProperties,createdTime)',
          orderBy: 'createdTime desc',
          pageToken
        });
        files.push(...(resp.data.files || []));
        pageToken = resp.data.nextPageToken;
      } while (pageToken);

      const mapped = files.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        caption: (f.appProperties && f.appProperties.caption) || f.description || '',
        uploadedBy: (f.appProperties && f.appProperties.uploadedBy) || '',
        uploadedAt: f.createdTime
      }));

      return res.json(mapped);
    }

    // Fallback (non-persistent on Render unless using a disk)
    const photos = await readPhotos(PHOTOS_JSON);
    return res.json(photos);
  } catch (err) {
    console.error('/api/list error:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

// ----------------- API: STREAM FILE -----------------
app.get('/api/file/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).send('Missing id');

  // local file
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
    driveRes.data.on('error', err => {
      console.error('Drive stream error:', err);
      if (!res.headersSent) res.status(500).send('Stream error');
    });
    driveRes.data.pipe(res);
  } catch (err) {
    console.error('/api/file error:', err && err.message ? err.message : err);
    res.status(500).send('Stream error');
  }
});

// ----------------- DIAG & HEALTH -----------------
app.get('/api/diag', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime(), ts: Date.now() }));

// ----------------- ROOT -----------------
app.get('/', (req, res) => res.redirect('/index.html'));

// ----------------- START -----------------
const listenPort = process.env.PORT ? Number(process.env.PORT) : Number(PORT || 4000);
const server = app.listen(listenPort, () => {
  console.log(`✅ Server listening on port ${listenPort} - NODE_ENV=${NODE_ENV}`);
  console.log(`Static dir: ${publicDir}`);
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

/**
 * Paginated photo list from Google Drive
 * Query: ?pageSize=20&pageToken=XYZ
 * Returns: { items: [...], nextPageToken: "..." | null }
 */
app.get("/api/photos", async (req, res) => {
  try {
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);
    const pageToken = req.query.pageToken || undefined;

    const drive = getDriveClient(); // your existing helper
    const folderId = process.env.GDRIVE_FOLDER_ID || process.env.DRIVE_FOLDER_ID || "";
    if (!folderId) return res.status(500).json({ error: "Folder ID missing" });

    const q = `'` + folderId + `' in parents and mimeType contains 'image/' and trashed=false`;
    const fields = "nextPageToken, files(id,name,modifiedTime,mimeType,thumbnailLink,webContentLink,webViewLink)";
    const resp = await drive.files.list({
      q,
      pageSize,
      pageToken,
      fields,
      orderBy: "modifiedTime desc",
      corpora: "user"
    });

    return res.json({
      items: resp.data.files || [],
      nextPageToken: resp.data.nextPageToken || null
    });
  } catch (err) {
    console.error("photos pagination error:", err?.response?.data || err);
    return res.status(500).json({ error: "Failed to list photos" });
  }
});

