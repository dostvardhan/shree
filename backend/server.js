// backend/server.js
// Node/Express + Google Drive (OAuth refresh token) + Netlify Identity auth (JWKS + /verify fallback) + image proxy

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { google } = require('googleapis');

// --- ENV ---
const PORT = process.env.PORT || 3000;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MAKE_PUBLIC = String(process.env.MAKE_PUBLIC || '').toLowerCase() === 'true';
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || null;

// Netlify Identity base (must point to the site where Identity is enabled)
const NETLIFY_IDENTITY_URL = process.env.NETLIFY_IDENTITY_URL || 'https://shreshthapushkar.com/.netlify/identity';

// JWKS (for RS256 JWTs). If token is opaque, we’ll fallback to /verify
const DEFAULT_JWKS = `${NETLIFY_IDENTITY_URL}/.well-known/jwks.json`;
const JWKS_URI = process.env.JWT_JWKS || DEFAULT_JWKS;

// --- APP ---
const app = express();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/postman
    if (ALLOWED.length === 0 || ALLOWED.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: false,
}));
app.use(express.json());

// --- Google OAuth2 (refresh token flow) ---
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
if (process.env.REFRESH_TOKEN) {
  oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
} else {
  console.warn('WARNING: REFRESH_TOKEN not set — Drive API calls will fail.');
}
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// --- JWKS client for RS256 tokens ---
const jwksClient = jwksRsa({
  jwksUri: JWKS_URI,
  cache: true,
  rateLimit: true,
});
function getKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

// --- Auth helpers ---
async function verifyViaJWKS(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded); // {sub, email, ...}
    });
  });
}
async function verifyViaNetlifyEndpoint(token) {
  // Node 18+ has global fetch (Render uses Node 24) ✔
  const resp = await fetch(`${NETLIFY_IDENTITY_URL}/verify`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`verify endpoint ${resp.status}`);
  return true;
}

async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer (.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: 'missing bearer token' });
    const token = m[1];

    // Testing bypass (USE ONLY TEMPORARILY)
    if (String(process.env.ALLOW_UNVERIFIED_JWT || '').toLowerCase() === 'true') {
      req.user = jwt.decode(token) || { sub: 'unknown' };
      return next();
    }

    let decoded = null;
    let jwtError = null;

    // 1) Try RS256 JWT (many Netlify setups give opaque tokens though)
    try {
      decoded = await verifyViaJWKS(token);
    } catch (e) {
      jwtError = e;
    }
    if (decoded) {
      req.user = decoded;
      return next();
    }

    // 2) Fallback to Netlify Identity verify endpoint (works with opaque tokens)
    try {
      await verifyViaNetlifyEndpoint(token);
      // Optionally fetch user details
      try {
        const r = await fetch(`${NETLIFY_IDENTITY_URL}/user`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (r.ok) {
          const info = await r.json();
          req.user = { sub: info.id, email: info.email };
        } else {
          req.user = { sub: 'netlify-verified' };
        }
      } catch {
        req.user = { sub: 'netlify-verified' };
      }
      return next();
    } catch (e2) {
      console.error('Auth verify failed:', {
        jwtError: jwtError?.message,
        netlify: e2?.message
      });
      return res.status(401).json({ ok: false, error: 'invalid token', hint: jwtError?.message || e2?.message });
    }
  } catch (e) {
    console.error('Auth error hard-fail:', e?.message || e);
    res.status(401).json({ ok: false, error: 'invalid token', hint: e?.message || 'verify failed' });
  }
}

// --- Helpers ---
function driveQueryForFolder(folderId) {
  if (!folderId) return "trashed = false";
  return `'${folderId}' in parents and trashed = false`;
}

// --- Routes ---
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/diag', async (req, res) => {
  try {
    const about = await drive.about.get({ fields: 'user(displayName, permissionId)' });
    res.json({ ok: true, user: about.data.user, folder: DRIVE_FOLDER_ID || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'drive auth failed', details: e?.message });
  }
});

// OPTIONAL: first-time OAuth dance (to get refresh token)
app.get('/auth/url', (req, res) => {
  const scopes = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly'];
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  });
  res.json({ ok: true, url });
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const code = req.query.code;
    const { tokens } = await oAuth2Client.getToken(code);
    res.json({ ok: true, tokens });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'oauth exchange failed' });
  }
});

// LIST (protected)
app.get('/list', requireAuth, async (req, res) => {
  try {
    let pageToken = null;
    const files = [];
    do {
      const { data } = await drive.files.list({
        q: driveQueryForFolder(DRIVE_FOLDER_ID),
        fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,parents)',
        orderBy: 'modifiedTime desc',
        pageSize: 100,
        pageToken,
      });
      (data.files || []).forEach(f => files.push(f));
      pageToken = data.nextPageToken;
    } while (pageToken);
    res.json({ ok: true, files });
  } catch (e) {
    console.error('LIST error', e?.response?.data || e);
    res.status(500).json({ ok: false, error: 'list failed' });
  }
});

// UPLOAD (protected)
app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });

    const fileMeta = {
      name: req.file.originalname,
      parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined,
    };

    const created = await drive.files.create({
      requestBody: fileMeta,
      media: { mimeType: req.file.mimetype, body: Buffer.from(req.file.buffer) },
      fields: 'id, name, mimeType, size, webViewLink, parents',
    });

    if (MAKE_PUBLIC) {
      try {
        await drive.permissions.create({
          fileId: created.data.id,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (_) {}
    }

    res.json({ ok: true, file: created.data });
  } catch (e) {
    console.error('UPLOAD error', e?.response?.data || e);
    res.status(500).json({ ok: false, error: 'upload failed' });
  }
});

// PUBLIC image/file proxy (no auth) — used by gallery <img>
app.get('/file/:id', async (req, res) => {
  try {
    const fileId = req.params.id;

    // Optional safety: ensure file is inside our folder
    if (DRIVE_FOLDER_ID) {
      try {
        const meta = await drive.files.get({ fileId, fields: 'parents' });
        const parents = meta.data.parents || [];
        if (!parents.includes(DRIVE_FOLDER_ID)) {
          return res.status(403).json({ ok: false, error: 'forbidden: outside folder' });
        }
      } catch (e) {
        if (e?.code === 404) return res.status(404).end('not found');
      }
    }

    let mimeType = 'application/octet-stream';
    try {
      const meta2 = await drive.files.get({ fileId, fields: 'mimeType, name' });
      if (meta2?.data?.mimeType) mimeType = meta2.data.mimeType;
    } catch (_) {}

    const dl = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    dl.data
      .on('error', (e) => {
        console.error('stream error', e?.message || e);
        if (!res.headersSent) res.status(500).end('stream error');
      })
      .pipe(res);
  } catch (e) {
    const code = e?.code || e?.response?.status || 500;
    if (!res.headersSent) {
      res.status(code).json({ ok: false, error: 'failed to fetch file' });
    }
  }
});

// Debug helpers
app.get('/whoami', async (req, res) => {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer (.+)$/i);
    if (!m) return res.status(401).json({ ok:false, error:'missing bearer token' });
    const token = m[1];
    let header = null, payload = null;
    try {
      header = JSON.parse(Buffer.from((token.split('.')[0] || ''), 'base64').toString('utf8'));
      payload = JSON.parse(Buffer.from((token.split('.')[1] || ''), 'base64').toString('utf8'));
    } catch (_) {}
    res.json({ ok:true, header, payload, length: token.length });
  } catch (e) {
    res.status(400).json({ ok:false, error: 'bad token' });
  }
});
app.get('/ping-auth', requireAuth, (req, res) => {
  res.json({ ok:true, me: req.user && (req.user.email || req.user.sub) });
});

// --- START ---
app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
