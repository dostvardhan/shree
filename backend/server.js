// server.js
// Secure Google Drive uploader with Netlify Identity (JWT), CORS and file streaming.

const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const PORT = process.env.PORT || 3000;

// ======== CONFIG ========
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shreshthapushkar.com';
const IDENTITY_ISSUER = `${SITE_ORIGIN}/.netlify/identity`;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || null;
const MAKE_PUBLIC = String(process.env.MAKE_PUBLIC || 'false').toLowerCase() === 'true';

// ======== BASIC CHECKS ========
if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !REFRESH_TOKEN) {
  // Don’t crash; show clear error on /diag
  console.warn('[WARN] Missing Google OAuth env vars. Check CLIENT_ID/CLIENT_SECRET/REDIRECT_URI/REFRESH_TOKEN.');
}

const app = express();

// CORS — only allow your site
app.use(
  cors({
    origin: SITE_ORIGIN,
    credentials: false,
  })
);

// Body/file parsing
app.use(express.json({ limit: '20mb' }));
app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    useTempFiles: true,
    tempFileDir: '/tmp',
    abortOnLimit: true,
    createParentPath: true,
  })
);

// ======== GOOGLE DRIVE CLIENT ========
function makeDrive() {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

// ======== NETLIFY IDENTITY JWT VERIFY (RS256 via JWKS) ========
const jwks = jwksClient({
  jwksUri: `${IDENTITY_ISSUER}/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000,
});

function getKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    try {
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    } catch (e) {
      callback(e);
    }
  });
}

/**
 * requireIdentity middleware:
 * - Reads Bearer token
 * - Verifies signature against Netlify Identity JWKS
 * - Checks issuer and role = member/admin
 */
function requireIdentity(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['RS256'],
      issuer: IDENTITY_ISSUER,
    },
    (err, payload) => {
      if (err) return res.status(401).json({ error: 'Invalid token' });

      const roles =
        (payload &&
          payload.app_metadata &&
          payload.app_metadata.authorization &&
          payload.app_metadata.authorization.roles) ||
        [];

      if (!roles.includes('member') && !roles.includes('admin')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = payload; // attach for downstream
      next();
    }
  );
}

// ======== OPEN ROUTES (optional to keep open) ========
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/diag', async (req, res) => {
  const diag = {
    ok: true,
    site_origin: SITE_ORIGIN,
    identity_issuer: IDENTITY_ISSUER,
    google_oauth_env: {
      has_client_id: !!CLIENT_ID,
      has_client_secret: !!CLIENT_SECRET,
      has_redirect_uri: !!REDIRECT_URI,
      has_refresh_token: !!REFRESH_TOKEN,
    },
    folder: DRIVE_FOLDER_ID || '(root or user My Drive)',
    make_public: MAKE_PUBLIC,
    now: new Date().toISOString(),
  };

  try {
    if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
      const drive = makeDrive();
      const about = await drive.about.get({ fields: 'user,storageQuota' });
      diag.user = about.data.user || null;
      diag.storage = about.data.storageQuota || null;
    }
  } catch (e) {
    diag.drive_error = e?.message || String(e);
  }

  res.json(diag);
});

// ======== PROTECTED ROUTES ========

// POST /upload  — multipart file -> Drive
app.post('/upload', requireIdentity, async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded (field name should be "file")' });
    }

    const file = req.files.file;
    const drive = makeDrive();

    const resource = {
      name: file.name,
      parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined,
    };

    // Upload
    const driveRes = await drive.files.create({
      requestBody: resource,
      media: {
        mimeType: file.mimetype || 'application/octet-stream',
        body: require('fs').createReadStream(file.tempFilePath),
      },
      fields: 'id,name,mimeType,size,webViewLink,webContentLink',
    });

    const created = driveRes.data;

    // Set sharing if MAKE_PUBLIC=true
    if (MAKE_PUBLIC) {
      try {
        await drive.permissions.create({
          fileId: created.id,
          requestBody: { type: 'anyone', role: 'reader' },
        });
        // refresh links after permission
        const meta = await drive.files.get({
          fileId: created.id,
          fields: 'id,name,mimeType,size,webViewLink,webContentLink',
        });
        return res.json({ ok: true, file: meta.data, public: true });
      } catch (e) {
        // even if sharing fails, return created meta
        return res.json({ ok: true, file: created, public: false, warn: e.message });
      }
    }

    // Private by default
    return res.json({ ok: true, file: created, public: false });
  } catch (e) {
    console.error('UPLOAD_ERROR', e);
    return res.status(500).json({ error: 'Upload failed', details: e?.message || String(e) });
  }
});

// GET /list — list files in folder (or My Drive)
app.get('/list', requireIdentity, async (req, res) => {
  try {
    const drive = makeDrive();

    let q = `'me' in owners and trashed=false`;
    if (DRIVE_FOLDER_ID) {
      q = `'${DRIVE_FOLDER_ID}' in parents and trashed=false`;
    }

    const r = await drive.files.list({
      q,
      fields: 'files(id,name,mimeType,size,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
    });

    res.json({ ok: true, files: r.data.files || [] });
  } catch (e) {
    console.error('LIST_ERROR', e);
    res.status(500).json({ error: 'List failed', details: e?.message || String(e) });
  }
});

// GET /file/:id — stream file (private, requires auth)
app.get('/file/:id', requireIdentity, async (req, res) => {
  try {
    const fileId = req.params.id;
    const drive = makeDrive();

    // Get metadata to set headers
    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size',
    });

    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.data.name)}"`);

    const driveStream = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    driveStream.data
      .on('error', (err) => {
        console.error('STREAM_ERROR', err);
        res.end();
      })
      .pipe(res);
  } catch (e) {
    console.error('FILE_STREAM_ERROR', e);
    res.status(500).json({ error: 'File stream failed', details: e?.message || String(e) });
  }
});

// (Optional) DELETE /file/:id — delete a file
app.delete('/file/:id', requireIdentity, async (req, res) => {
  try {
    const fileId = req.params.id;
    const drive = makeDrive();
    await drive.files.delete({ fileId });
    res.json({ ok: true, deleted: fileId });
  } catch (e) {
    console.error('DELETE_ERROR', e);
    res.status(500).json({ error: 'Delete failed', details: e?.message || String(e) });
  }
});

// ======== START ========
app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
