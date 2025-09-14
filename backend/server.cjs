// server.cjs (CommonJS)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const stream = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.PORT || 4000;
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(x => x.trim()).filter(Boolean);
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',');

if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  console.error("AUTH0_DOMAIN and AUTH0_AUDIENCE are required");
  process.exit(1);
}

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// JWKS client
const client = jwksClient({
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function(err, key) {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function isAllowedUser(decoded) {
  const email = decoded && (decoded.email || decoded['email']);
  const sub = decoded && decoded.sub;
  if (ALLOWED_USERS.length === 0) return true;
  return (email && ALLOWED_USERS.includes(email)) || (sub && ALLOWED_USERS.includes(sub));
}

function verifyJWT(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).send('Missing token');
  const token = auth.split(' ')[1];

  jwt.verify(token, getKey, {
    audience: AUTH0_AUDIENCE,
    issuer: `https://${AUTH0_DOMAIN}/`,
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      console.error("JWT verify error:", err);
      return res.status(401).send('Invalid token');
    }
    if (!isAllowedUser(decoded)) return res.status(403).send('User not allowed');
    req.user = decoded;
    next();
  });
}

// Health check
app.get('/api/diag', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// List uploaded photos metadata
app.get('/api/list', verifyJWT, (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, 'photos.json');
  try {
    const arr = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]');
    res.json(arr);
  } catch (e) {
    res.json([]);
  }
});

// Upload photo + caption → Google Drive
app.post('/api/upload', verifyJWT, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');
    const caption = req.body.caption || '';

    // Google OAuth2 client with refresh token
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    const ext = (req.file.originalname.match(/\.[^/.]+$/) || ['.jpg'])[0];
    const filename = `photo_${Date.now()}${ext}`;

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const fileMetadata = {
      name: filename,
      parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined
    };

    const created = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: req.file.mimetype,
        body: bufferStream
      },
      fields: 'id, name, mimeType'
    });

    const fileId = created.data.id;

    // Save metadata locally
    const metaPath = path.join(UPLOAD_DIR, 'photos.json');
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '[]'); } catch (e) { arr = []; }
    const metadata = {
      id: fileId,
      name: created.data.name,
      caption,
      uploadedBy: req.user.email || req.user.sub,
      uploadedAt: new Date().toISOString()
    };
    arr.push(metadata);
    fs.writeFileSync(metaPath, JSON.stringify(arr, null, 2));

    res.json({ message: 'Uploaded to Google Drive', id: fileId, metadata });
  } catch (err) {
    console.error('Upload error', err);
    res.status(500).send('Upload failed: ' + (err.message || String(err)));
  }
});

// Stream file securely
app.get('/api/file/:id', verifyJWT, async (req, res) => {
  const fileId = req.params.id;
  try {
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    driveRes.data.pipe(res);
  } catch (err) {
    console.error('File fetch error', err);
    res.status(500).send('File fetch error');
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
