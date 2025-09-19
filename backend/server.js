const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('express-jwt');
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

// Public static assets (index & auth scripts)
app.use(express.static(STATIC_DIR, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    const publicFiles = [
      'index.html',
      'auth-init.js',
      'guard-auth.js',
      'auth0-spa-js.production.js'
    ];
    const rel = path.basename(filePath);
    if (publicFiles.includes(rel)) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));

// Auth0 JWT middleware config
const jwtMiddleware = jwt({
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

// Protect API routes (diag excluded)
app.use('/api', (req, res, next) => {
  if (req.path === '/diag') return next();

  const hasSessionCookie = req.cookies && req.cookies['shree_session'];
  const hasAuthHeader = typeof req.headers.authorization === 'string' &&
    req.headers.authorization.startsWith('Bearer ');

  if (!hasAuthHeader && !hasSessionCookie) {
    return res.status(401).json({ error: 'No authorization token was found' });
  }

  if (hasSessionCookie && !hasAuthHeader) {
    req.isSession = true;
    return next();
  }

  return jwtMiddleware(req, res, next);
});

// API: diag (for testing auth)
app.get('/api/diag', (req, res) => {
  if (req.isSession || req.user) {
    return res.json({ status: 'ok', user: req.user || 'session-user' });
  }
  return res.status(401).json({ error: 'Unauthorized' });
});

// Default unauthorized handler
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

console.log(`Static files served from: ${STATIC_DIR}`);
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
