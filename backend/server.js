// backend/server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { Readable } = require('stream');
const fetch = require('node-fetch'); // if using Node 18+ you can switch to global fetch
const { google } = require('googleapis');

const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

/* ---------- Config (from env) ---------- */
const PORT = process.env.PORT || 4000;
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || `https://${AUTH0_DOMAIN}/api/v2/`;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'change_this_cookie_secret';
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || null;
const MAKE_PUBLIC = (process.env.MAKE_PUBLIC || 'false') === 'true';

/* ---------- Middleware ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));

/* ---------- JWT helper that reads token from Authorization header OR signed cookie ---------- */
const checkJwtFromToken = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
  }),
  audience: AUTH0_AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  algorithms: ['RS256'],
  getToken: (req) => {
    if (req.headers && req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
      return req.headers.authorization.split(' ')[1];
    }
    if (req.signedCookies && req.signedCookies.access_token) return req.signedCookies.access_token;
    if (req.signedCookies && req.signedCookies.id_token) return req.signedCookies.id_token;
    return null;
  }
});

/* ---------- Auth0 Authorization Code flow (server-side) ---------- */
function randomString(len = 24) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

app.get('/auth/login', (req, res) => {
  const state = randomString(24);
  res.cookie('auth_state', state, { httpOnly: true, secure: true, signed: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 });
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH0_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    audience: AUTH0_AUDIENCE,
    state
  });
  const url = `https://${AUTH0_DOMAIN}/authorize?${params.toString()}`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const savedState = req.signedCookies && req.signedCookies.auth_state;
    if (!state || !savedState || state !== savedState) {
      console.error('Invalid state', { state, savedState });
      return res.status(400).send('Invalid state. Try again.');
    }

    const tokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
    const body = {
      grant_type: 'authorization_code',
      client_id: AUTH0_CLIENT_ID,
      client_secret: AUTH0_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    };

    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok) {
      console.error('token exchange failed', tokenJson);
      return res.status(500).send('Token exchange failed');
    }

    res.cookie('access_token', tokenJson.access_token, { httpOnly: true, secure: true, signed: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });
    if (tokenJson.id_token) {
      res.cookie('id_token', tokenJson.id_token, { httpOnly: true, secure: true, signed: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });
    }
    res.clearCookie('auth_state');
    res.redirect('/life.html');
  } catch (err) {
    console.error('callback error', err);
    res.status(500).send('Auth callback error');
  }
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('access_token');
  res.clearCookie('id_token');
  const returnTo = `${req.protocol}://${req.get('host')}/index.html`;
  const logoutUrl = `https://${AUTH0_DOMAIN}/v2/logout?client_id=${AUTH0_CLIENT_ID}&returnTo=${encodeURIComponent(returnTo)}`;
  res.redirect(logoutUrl);
});

/* ---------- Protect static files middleware (before static serve) ---------- */
function protectStatic(req, res, next) {
  const protectedExt = /\.(html|jpg|jpeg|png|gif|webp)$/i;
  if (req.method !== 'GET' || !protectedExt.test(req.path)) return next();

  checkJwtFromToken(req, res, (err) => {
    if (err) {
      return res.redirect('/index.html');
    }
    const email = req.auth && req.auth.email;
    if (ALLOWED_USERS.length && (!email || !ALLOWED_USERS.includes(email))) {
      return res.status(403).send('Access denied');
    }
    next();
  });
}
app.use(protectStatic);

/* ---------- Static files: expect frontend inside backend/public ---------- */
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

/* ---------- Google Drive setup ---------- */
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}
const drive = google.drive({ version: 'v3', auth: oauth2Client });

/* ---------- Helpers ---------- */
function saveMetadataEntry(entry) {
  const metaPath = path.join(__dirname, 'photos.json');
  let arr = [];
  try {
    arr = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!Array.isArray(arr)) arr = [];
  } catch (e) {
    arr = [];
  }
  arr.unshift(entry);
  fs.writeFileSync(metaPath, JSON.stringify(arr, null, 2));
}

/* ---------- API endpoints (protected) ---------- */

// diag
app.get('/api/diag', checkJwtFromToken, (req, res) => {
  const email = req.auth && req.auth.email;
  if (!email) return res.status(403).json({ error: 'no-email' });
  if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(email)) return res.status(403).json({ error: 'not-allowed' });
  res.json({ status: 'ok', email });
});

// list
app.get('/api/list', checkJwtFromToken, (req, res) => {
  const email = req.auth && req.auth.email;
  if (!email) return res.status(403).json({ error: 'no-email' });
  if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(email)) return res.status(403).json({ error: 'not-allowed' });
  const metaPath = path.join(__dirname, 'photos.json');
  try {
    const arr = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const out = (arr || []).map(a => ({ id: a.id, caption: a.caption, created: a.created }));
    return res.json(out);
  } catch (e) {
    return res.json([]);
  }
});

// upload
app.post('/api/upload', checkJwtFromToken, upload.single('photo'), async (req, res) => {
  try {
    const email = req.auth && req.auth.email;
    if (!email) return res.status(403).send('no-email');
    if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(email)) return res.status(403).send('not-allowed');

    if (!req.file) return res.status(400).send('no-file');
    const caption = req.body.caption || '';
    const fileName = `${Date.now()}_${req.file.originalname}`;
    const stream = Readable.from(req.file.buffer);

    const createParams = {
      requestBody: {
        name: fileName,
        parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined
      },
      media: {
        mimeType: req.file.mimetype,
        body: stream
      },
      fields: 'id,name,mimeType'
    };

    const driveResp = await drive.files.create(createParams);
    const fileId = driveResp && driveResp.data && driveResp.data.id;
    if (!fileId) throw new Error('no-file-id');

    if (MAKE_PUBLIC) {
      try {
        await drive.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (e) {
        console.warn('make public failed', e.message || e);
      }
    }

    const entry = { id: fileId, name: fileName, caption, uploader: email, created: Date.now() };
    saveMetadataEntry(entry);

    res.json({ ok: true, id: fileId });
  } catch (err) {
    console.error('upload error', err);
    res.status(500).send('upload error');
  }
});

// stream file
app.get('/api/file/:id', checkJwtFromToken, async (req, res) => {
  try {
    const email = req.auth && req.auth.email;
    if (!email) return res.status(403).send('no-email');
    if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(email)) return res.status(403).send('not-allowed');

    const fileId = req.params.id;
    try {
      const meta = await drive.files.get({ fileId, fields: 'mimeType' });
      if (meta && meta.data && meta.data.mimeType) res.set('Content-Type', meta.data.mimeType);
    } catch (e) { /* ignore */ }

    const resp = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    resp.data.pipe(res);
  } catch (err) {
    console.error('file stream error', err);
    res.status(404).send('not found');
  }
});

/* ---------- Fallbacks ---------- */
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.use((req, res) => res.status(404).send('Not found'));

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
