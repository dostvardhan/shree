// server.js
// Google Drive uploader + viewer with Netlify Identity auth (token introspection), CORS & streaming.

const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { google } = require('googleapis');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// ======== CONFIG ========
const SITE_ORIGIN =
  process.env.SITE_ORIGIN ||
  process.env.ALLOWED_ORIGIN || // fallback if you used ALLOWED_ORIGIN earlier
  'https://shreshthapushkar.com';

const IDENTITY_ISSUER = `${SITE_ORIGIN}/.netlify/identity`;

const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const REDIRECT_URI = process.env.REDIRECT_URI || '';
const REFRESH_TOKEN = process.env.REFRESH_TOKEN || '';

const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || null;
const MAKE_PUBLIC = String(process.env.MAKE_PUBLIC || 'false').toLowerCase() === 'true';

// ======== APP ========
const app = express();

// CORS — only allow your site
app.use(
  cors({
    origin: SITE_ORIGIN,
    credentials: false,
  })
);

// JSON + file uploads
app.use(express.json({ limit: '20mb' }));
app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    useTempFiles: true,
    tempFileDir: '/tmp',
    abortOnLimit: true,
    createParentPath: true,
  })
);

// ======== GOOGLE DRIVE ========
function makeDrive() {
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

// ======== NETLIFY IDENTITY (TOKEN INTROSPECTION) ========
// Works for HS256 or RS256; relies on Netlify Identity to validate token.
async function requireIdentity(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    // Validate token with Identity
    const r = await fetch(`${IDENTITY_ISSUER}/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!r.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await r.json();

    // Roles are usually in app_metadata.authorization.roles OR app_metadata.roles
    const roles =
      user?.app_metadata?.authorization?.roles ||
      user?.app_metadata?.roles ||
      [];

    if (!roles.includes('member') && !roles.includes('admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.user = user; // attach for downstream use
    next();
  } catch (e) {
    console.error('IDENTITY_INTROSPECT_ERROR', e);
    return res.status(401).json({ error: 'Auth failed' });
  }
}

// ======== OPEN ROUTES ========
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/diag', async (req, res) => {
  const diag = {
    ok: true,
    site_origin: SITE_ORIGIN,
    identity_issuer: IDENTITY_ISSUER,
    env: {
      has_client_id: !!CLIENT_ID,
      has_client_secret: !!CLIENT_SECRET,
      has_redirect_uri: !!REDIRECT_URI,
      has_refresh_token: !!REFRESH_TOKEN,
    },
    folder: DRIVE_FOLDER_ID || '(My Drive root)',
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

// Upload a file to Drive
app.post('/upload', requireIdentity, async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded (use field name "file")' });
    }

    const file = req.files.file;
    const drive = makeDrive();

    const meta = {
      name: file.name,
      parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined,
    };

    const created = await drive.files.create({
      requestBody: meta,
      media: {
        mimeType: file.mimetype || 'application/octet-stream',
        body: fs.createReadStream(file.tempFilePath),
      },
      fields: 'id,name,mimeType,size,webViewLink,webContentLink',
    });

    const data = created.data;

    if (MAKE_PUBLIC) {
      try {
        await drive.permissions.create({
          fileId: data.id,
          requestBody: { type: 'anyone', role: 'reader' },
        });
        const refreshed = await drive.files.get({
          fileId: data.id,
          fields: 'id,name,mimeType,size,webViewLink,webContentLink',
        });
        return res.json({ ok: true, file: refreshed.data, public: true });
      } catch (e) {
        return res.json({ ok: true, file: data, public: false, warn: e.message });
      }
    }

    res.json({ ok: true, file: data, public: false });
  } catch (e) {
    console.error('UPLOAD_ERROR', e);
    res.status(500).json({ error: 'Upload failed', details: e?.message || String(e) });
  }
});

// List files
app.get('/list', requireIdentity, async (req, res) => {
  try {
    const drive = makeDrive();
    let q = `trashed=false and 'me' in owners`;
    if (DRIVE_FOLDER_ID) q = `'${DRIVE_FOLDER_ID}' in parents and trashed=false`;

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

// Stream a file
app.get('/file/:id', requireIdentity, async (req, res) => {
  try {
    const fileId = req.params.id;
    const drive = makeDrive();

    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size',
    });

    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.data.name)}"`);

    const streamRes = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    streamRes.data
      .on('error', (err) => {
        console.error('STREAM_ERROR', err);
        res.end();
      })
      .pipe(res);
  } catch (e) {
    console.error('FILE_ERROR', e);
    res.status(500).json({ error: 'File stream failed', details: e?.message || String(e) });
  }
});

// Delete a file
app.delete('/file/:id', requireIdentity, async (req, res) => {
  try {
    const drive = makeDrive();
    await drive.files.delete({ fileId: req.params.id });
    res.json({ ok: true, deleted: req.params.id });
  } catch (e) {
    console.error('DELETE_ERROR', e);
    res.status(500).json({ error: 'Delete failed', details: e?.message || String(e) });
  }
});

// ======== START ========
app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
