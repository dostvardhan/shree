// backend/server.js
// Express + Google Drive + Netlify Identity (private gallery) — robust issuer handling

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { google } = require('googleapis');

const app = express();

/* ------------------------- CORS ------------------------- */
const ALLOW_ORIGINS = [
  'https://shreshthapushkar.com',
  'https://www.shreshthapushkar.com',
  'http://localhost:8888',
  'http://localhost:5173',
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, ALLOW_ORIGINS.includes(origin));
    },
    allowedHeaders: ['Authorization', 'Content-Type', 'X-NI-Issuer'],
    credentials: false,
  })
);

/* ------------------------- ENV ------------------------- */
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,
  NETLIFY_IDENTITY_ISSUER, // optional fallback
} = process.env;

/* ------------------------- Google Drive ------------------------- */
const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

/* ------------------------- Identity verify (robust) ------------------------- */
// Helpers
function urlSafeDecodeJwtNoVerify(token) {
  try {
    const part = token.split('.')[1];
    const s = Buffer.from(
      part.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normIssuer(base) {
  if (!base) return null;
  let b = String(base).trim();
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  b = b.replace(/\/+$/, '');
  return b + '/.netlify/identity';
}

function jwksUriFor(issuer) {
  const base = issuer.replace(/\/+$/, '');
  return `${base}/.well-known/jwks.json`;
}

const jwksCache = new Map();
function makeJwksClient(jwksUri) {
  if (!jwksCache.has(jwksUri)) {
    jwksCache.set(
      jwksUri,
      jwksClient({
        jwksUri,
        cache: true,
        cacheMaxEntries: 10,
        cacheMaxAge: 60 * 60 * 1000,
      })
    );
  }
  return jwksCache.get(jwksUri);
}

async function pickIssuerBase(req, tokenDec) {
  const headerIssuer = req.headers['x-ni-issuer']
    ? String(req.headers['x-ni-issuer'])
    : null;
  const envIssuer = NETLIFY_IDENTITY_ISSUER || null;
  const tokenIssuer = tokenDec?.iss || null;

  const candidates = [headerIssuer, envIssuer, tokenIssuer].filter(Boolean);

  for (const cand of candidates) {
    const iss = cand.includes('/.netlify/identity') ? cand : normIssuer(cand);
    if (!iss) continue;
    try {
      const jwksUrl = jwksUriFor(iss);
      const res = await fetch(jwksUrl, { method: 'GET', redirect: 'follow' });
      if (res.ok) return iss;
    } catch {
      // ignore and try next
    }
  }
  return null;
}

async function netlifyUserCheck(issuer, token) {
  try {
    const url = issuer.replace(/\/+$/, '') + '/user';
    const r = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return data && data.email ? data : null;
  } catch {
    return null;
  }
}

async function ensureAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ ok: false, error: 'NO_TOKEN' });
    }

    const decoded = urlSafeDecodeJwtNoVerify(token);

    // 1) Find a working issuer (header/env/token), following redirects
    let issuer = await pickIssuerBase(req, decoded);
    if (!issuer) {
      const hdr = req.headers['x-ni-issuer']
        ? String(req.headers['x-ni-issuer'])
        : null;
      if (hdr) {
        const u = new URL(hdr);
        const bases = [
          `${u.protocol}//${u.hostname}`,
          `${u.protocol}//www.${u.hostname.replace(/^www\./, '')}`,
        ];
        for (const b of bases) {
          const iss = normIssuer(b);
          try {
            const res2 = await fetch(jwksUriFor(iss), { redirect: 'follow' });
            if (res2.ok) {
              issuer = iss;
              break;
            }
          } catch {
            // try next
          }
        }
      }
    }

    // 2) Primary: verify via JWKS if issuer found
    if (issuer) {
      const client = makeJwksClient(jwksUriFor(issuer));
      function getKey(header, cb) {
        client.getSigningKey(header.kid, (err, key) => {
          if (err) return cb(err);
          cb(null, key.getPublicKey());
        });
      }
      const verifyOpts = { algorithms: ['RS256'] };
      if (decoded?.iss) verifyOpts.issuer = decoded.iss; // enforce only if present

      try {
        jwt.verify(token, getKey, verifyOpts, (err, verified) => {
          if (err) throw err;
          req.user = verified;
          return next();
        });
        return; // handled in callback
      } catch {
        // fall through to /user check
      }
    }

    // 3) Fallback: use Identity /user endpoint to validate token
    const tryIssuers = [];
    if (req.headers['x-ni-issuer'])
      tryIssuers.push(String(req.headers['x-ni-issuer']));
    if (NETLIFY_IDENTITY_ISSUER) tryIssuers.push(NETLIFY_IDENTITY_ISSUER);
    if (decoded?.iss) tryIssuers.push(decoded.iss);

    for (const cand of tryIssuers) {
      const iss = cand.includes('/.netlify/identity') ? cand : normIssuer(cand);
      const userInfo = await netlifyUserCheck(iss, token);
      if (userInfo) {
        req.user = {
          sub: userInfo.id || userInfo.sub || userInfo.email,
          email: userInfo.email,
          iss,
        };
        return next();
      }
    }

    return res
      .status(401)
      .json({ ok: false, error: 'invalid token', hint: 'JWKS & /user validation failed' });
  } catch (e) {
    console.error('AUTH_MIDDLEWARE_ERR', e?.message);
    return res.status(401).json({ ok: false, error: 'AUTH_ERR' });
  }
}

/* ------------------------- Health & Diag ------------------------- */
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/diag', async (_req, res) => {
  try {
    let driveOk = false,
      quota = null,
      user = null;
    try {
      const about = await drive.about.get({
        fields:
          'user(displayName,emailAddress,permissionId),storageQuota(limit,usage)',
      });
      driveOk = true;
      quota = about.data?.storageQuota || null;
      user = about.data?.user || null;
    } catch {
      // ignore
    }
    res.json({
      ok: true,
      user,
      folder: DRIVE_FOLDER_ID || null,
      driveOk,
      quota,
      time: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ ok: false, error: 'DIAG_ERR' });
  }
});

/* ------------------------- Multer (memory) ------------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

/* ------------------------- LIST (private) ------------------------- */
app.get('/list', ensureAuth, async (_req, res) => {
  try {
    const qParts = ['trashed = false'];
    if (DRIVE_FOLDER_ID) qParts.push(`'${DRIVE_FOLDER_ID}' in parents`);
    const q = qParts.join(' and ');

    const r = await drive.files.list({
      q,
      pageSize: 200,
      fields: 'files(id,name,mimeType,size,modifiedTime)',
      orderBy: 'modifiedTime desc',
    });

    res.json({ ok: true, files: r.data.files || [] });
  } catch (e) {
    console.error('LIST_ERR', e?.message);
    res.status(500).json({ ok: false, error: 'LIST_ERR' });
  }
});

/* ------------------------- UPLOAD (private) ------------------------- */
app.post('/upload', ensureAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ ok: false, error: 'NO_FILE' });

    const fileMetadata = {
      name: req.file.originalname,
      ...(DRIVE_FOLDER_ID ? { parents: [DRIVE_FOLDER_ID] } : {}),
    };
    const media = {
      mimeType: req.file.mimetype,
      body: require('stream').Readable.from(req.file.buffer),
    };

    const created = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id,name,mimeType,size,modifiedTime',
    });

    res.json({ ok: true, file: created.data });
  } catch (e) {
    console.error('UPLOAD_ERR', e?.message);
    const msg = String(e?.message || '');
    if (msg.includes('insufficientFilePermissions')) {
      return res
        .status(403)
        .json({ ok: false, error: 'INSUFFICIENT_PERMS' });
    }
    res.status(500).json({ ok: false, error: 'UPLOAD_ERR' });
  }
});

/* ------------------------- FILE STREAM (private) ------------------------- */
app.get('/file/:id', ensureAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const meta = await drive.files.get({
      fileId: id,
      fields: 'name,mimeType,modifiedTime,size',
    });
    const { name, mimeType, modifiedTime, size } = meta.data || {};

    const driveRes = await drive.files.get(
      { fileId: id, alt: 'media' },
      { responseType: 'stream' }
    );

    if (mimeType) res.setHeader('Content-Type', mimeType);
    if (name) res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    if (size) res.setHeader('Content-Length', size);
    if (modifiedTime)
      res.setHeader('Last-Modified', new Date(modifiedTime).toUTCString());
    res.setHeader('Cache-Control', 'public, max-age=86400');

    driveRes.data.on('error', (e) => {
      console.error('Drive stream error:', e?.message);
      if (!res.headersSent)
        res.status(502).json({ ok: false, error: 'STREAM_ERROR' });
    });

    driveRes.data.pipe(res);
  } catch (err) {
    console.error('FILE_STREAM_ERROR', err?.message);
    if (!res.headersSent)
      res.status(500).json({ ok: false, error: 'FILE_STREAM_ERROR' });
  }
});

/* ------------------------- Start ------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Server listening on', PORT);
});
