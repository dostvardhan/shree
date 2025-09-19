// backend/server.js (corrected import for express-jwt)
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { expressjwt: jwt } = require('express-jwt'); // <-- correct import
const jwksRsa = require('jwks-rsa');

const app = express();

const PORT = process.env.PORT || 4000;
const STATIC_DIR = path.join(__dirname, process.env.STATIC_DIR || 'private');
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

// Middleware
app.use(cookieParser());
app.use(express.json());

// Health check (for Render)
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Serve public static assets (index & auth scripts). express.static will serve files from STATIC_DIR
app.use(express.static(STATIC_DIR, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    const publicFiles = [
      'index.html',
      'auth-init.js',
      'guard-auth.js',
      'auth0-spa-js.production.js',
      'style.css'
    ];
    const rel = path.basename(filePath);
    if (publicFiles.includes(rel)) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));

// Simple function to check for a session cookie
function hasSessionCookie(req) {
  return !!(req.cookies && (req.cookies.shree_session || req.cookies.shree_session === '1'));
}

// Configure express-jwt middleware (but mount only on /api)
let jwtMiddleware;
if (AUTH0_DOMAIN && AUTH0_AUDIENCE) {
  jwtMiddleware = jwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
    }),
    audience: AUTH0_AUDIENCE,
    issuer: `https://${AUTH0_DOMAIN}/`,
    algorithms: ['RS256']
  });
} else {
  console.warn('AUTH0_DOMAIN or AUTH0_AUDIENCE missing — /api routes will not validate tokens until configured.');
}

// Mount JWT logic for /api routes only
app.use('/api', (req, res, next) => {
  // allow /api/diag public
  if (req.path === '/diag') return next();

  const hasAuthHeader = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ');
  const session = hasSessionCookie(req);

  if (!hasAuthHeader && !session) {
    return res.status(401).json({ error: 'No authorization token was found' });
  }

  if (session && !hasAuthHeader) {
    req.isSession = true;
    return next();
  }

  // validate access token
  if (jwtMiddleware) return jwtMiddleware(req, res, next);
  return res.status(500).json({ error: 'JWT middleware not configured' });
});

// Public diag endpoint — client uses this to check auth status
app.get('/api/diag', (req, res) => {
  try {
    if (hasSessionCookie(req)) return res.json({ ok: true, session: true });
    // If jwt middleware ran earlier it would have attached req.auth/user, but for diag we kept it public
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Example protected API endpoints
app.get('/api/list', (req, res) => {
  // If using session-based auth, req.isSession will be true; if token-based, req.auth will exist.
  if (!req.isSession && !req.auth) return res.status(401).json({ error: 'Unauthorized' });

  // TODO: implement list logic using drive or photos.json
  return res.json({ ok: true, items: [] });
});

app.post('/api/upload', (req, res) => {
  if (!req.isSession && !req.auth) return res.status(401).json({ error: 'Unauthorized' });

  // TODO: implement upload logic
  return res.json({ ok: true, message: 'upload endpoint placeholder' });
});

// Minimal /auth endpoints (if you have your own implementation, keep that instead)
app.get('/auth/login', (req, res) => {
  if (!AUTH0_DOMAIN || !process.env.AUTH0_CLIENT_ID) {
    return res.status(500).send('Auth0 not configured');
  }
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.AUTH0_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    audience: AUTH0_AUDIENCE || ''
  });
  return res.redirect(`https://${AUTH0_DOMAIN}/authorize?${params.toString()}`);
});

app.get('/auth/callback', (req, res) => {
  // Keep your existing token-exchange logic here — set a secure HttpOnly cookie (shree_session) after successful auth.
  // Placeholder: set a cookie and redirect inside the demo
  res.cookie('shree_session', '1', { httpOnly: true, sameSite: 'lax' });
  return res.redirect('/life.html');
});

// Default handler for unknown routes - if accepts html send index
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(STATIC_DIR, 'index.html'));
  }
  return res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  if (err && err.name === 'UnauthorizedError') {
    // short error JSON for auth failures
    return res.status(err.status || 401).json({ error: err.message || 'Unauthorized' });
  }
  console.error(err && err.stack ? err.stack : err);
  return res.status(500).json({ error: 'Server error' });
});

console.log(`Static files served from: ${STATIC_DIR}`);
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
