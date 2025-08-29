// server.js (auth + health + debug core)

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const app = express();

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
  'https://shreshthapushkar.com',
  // optionally add your netlify subdomain too if you sometimes use it:
  // 'https://<your-site>.netlify.app'
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  }
}));

// ---------- AUTH CORE ----------
function decodeOrThrow(token) {
  const dec = jwt.decode(token, { complete: true });
  if (!dec) throw new Error('Bad token: cannot decode');
  if (!dec.payload) throw new Error('Bad token: no payload');
  if (!dec.header?.kid) throw new Error('Bad token: no kid');
  const iss = (dec.payload.iss || '').replace(/\/+$/, '');
  if (!iss) throw new Error('No iss in token (use currentUser().jwt())');
  return { iss, header: dec.header, payload: dec.payload };
}

function makeJwksClient(iss) {
  return jwksClient({
    jwksUri: `${iss}/.well-known/jwks.json`,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000
  });
}

async function verifyNetlifyJWT(token) {
  const { iss, header } = decodeOrThrow(token);
  const client = makeJwksClient(iss);
  const key = await client.getSigningKey(header.kid);
  const pub = key.getPublicKey();
  const verified = jwt.verify(token, pub, {
    algorithms: ['RS256'],
    issuer: iss
  });
  return { ...verified, iss };
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer (.+)$/);
    if (!m) throw new Error('No bearer token');
    const token = m[1];
    if (token.length < 100) throw new Error('Token too short; not a Netlify Identity JWT');
    const payload = await verifyNetlifyJWT(token);
    req.user = payload;
    next();
  } catch (e) {
    console.error('AUTH ERROR:', e);
    res.status(401).json({ ok: false, error: String(e.message) });
  }
}

// ---------- HEALTH ----------
app.get('/', (_req, res) => res.type('text/plain').send('ok'));

app.get('/diag', (req, res) => {
  const hasBearer = /^Bearer /.test(req.headers.authorization || '');
  res.json({
    ok: true,
    service: 'shree-drive',
    time: new Date().toISOString(),
    note: 'JWKS/Drive checks skipped here; keep this lightweight for Render health checks.',
    hasBearer
  });
});

// ---------- DEBUG (temp; keep during setup) ----------
app.get('/whoami', (req, res) => {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return res.json({ ok: false, error: 'No bearer token' });
  const dec = jwt.decode(m[1], { complete: true });
  res.json({ ok: true, header: dec?.header, payload: dec?.payload });
});

app.get('/auth-test', requireAuth, (req, res) => {
  res.json({ ok: true, email: req.user?.email, iss: req.user?.iss, sub: req.user?.sub });
});

// ---------- YOUR EXISTING ROUTES ----------
// just ensure they are protected:
app.post('/upload', requireAuth, /* your existing upload handler */ (req, res) => {
  res.status(500).json({ ok: false, error: 'Upload handler not wired here' });
});
app.get('/list', requireAuth, /* your existing list handler */ (req, res) => {
  res.status(500).json({ ok: false, error: 'List handler not wired here' });
});
app.get('/file/:id', requireAuth, /* your existing file handler */ (req, res) => {
  res.status(500).json({ ok: false, error: 'File handler not wired here' });
});

// ---------- LISTEN ----------
app.listen(process.env.PORT || 10000, '0.0.0.0', () => {
  console.log('server on :' + (process.env.PORT || 10000));
});
