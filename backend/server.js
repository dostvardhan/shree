// server.js — Shree private backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bodyParser = require('body-parser');
const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// ----- CORS -----
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow curl/postman
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed for origin: ' + origin));
  },
  credentials: true
}));

// ----- Auth0 Config -----
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://shree-drive.onrender.com';
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
  }),
  audience: AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  algorithms: ['RS256']
});

// ----- Google Drive Client -----
function createDriveClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oAuth2Client });
}

// ----- Endpoints -----
app.get('/api/diag', checkJwt, (req, res) => {
  res.json({ status: 'ok', user: req.user });
});

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/upload', checkJwt, upload.single('photo'), async (req, res) => {
  try {
    const email = req.user && (req.user.email || req.user['https://shree/email']);
    if (!email) return res.status(403).send('no-email-in-token');
    if (!ALLOWED_USERS.includes(email)) return res.status(403).send('user-not-allowed');
    if (!req.file) return res.status(400).send('no-file');

    const drive = createDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || undefined;

    const stream = require('stream');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const r = await drive.files.create({
      requestBody: {
        name: `${Date.now()}_${req.file.originalname}`,
        parents: folderId ? [folderId] : undefined
      },
      media: { body: bufferStream }
    });

    if (process.env.MAKE_PUBLIC === 'true') {
      await drive.permissions.create({
        fileId: r.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
    }

    // append metadata
    const metaPath = path.join(__dirname, 'photos.json');
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)) : [];
    meta.unshift({
      id: r.data.id,
      caption: req.body.caption || '',
      created_at: new Date().toISOString()
    });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    res.json({ ok: true, fileId: r.data.id });
  } catch (err) {
    console.error('upload err', err);
    res.status(500).send('upload-error');
  }
});

app.get('/api/list', checkJwt, (req, res) => {
  const metaPath = path.join(__dirname, 'photos.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)) : [];
  res.json(meta);
});

app.get('/api/file/:id', checkJwt, async (req, res) => {
  try {
    const drive = createDriveClient();
    const stream = await drive.files.get(
      { fileId: req.params.id, alt: 'media' },
      { responseType: 'stream' }
    );
    res.setHeader('Content-Type', 'image/jpeg'); // basic guess
    stream.data.pipe(res);
  } catch (err) {
    console.error('file stream err', err);
    res.status(500).send('file-stream-error');
  }
});

// ----- Start Server -----
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('server listening on', PORT));
