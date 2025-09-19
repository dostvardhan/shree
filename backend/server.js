// backend/server.js
// Full example server that:
// - Serves static files from backend/private
// - Exposes public index + a few public assets
// - Protects only /api/* routes with express-jwt (Auth0)
// - Provides /auth/login and /auth/callback entrypoints (leave your existing logic inside)
// - Exposes /health and /api/diag as public endpoints for Render health checks

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { expressjwt: jwt } = require('express-jwt'); // v7 style
const jwksRsa = require('jwks-rsa');

const app = express();
app.use(express.json());
app.use(cookieParser());

// CONFIG from env
const STATIC_DIR = process.env.STATIC_DIR || 'private'; // backend/private
const PORT = parseInt(process.env.PORT || '4000', 10);
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN; // e.g. dev-xxx.us.auth0.com
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE; // e.g. https://shree-drive.onrender.com
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);

// where static files live
const staticRoot = path.join(__dirname, STATIC_DIR);

// --- Public asset whitelist ---
// Add any static asset you want anonymous visitors to access without auth
const PUBLIC_PATHS = new Set([
  '/',                // root -> index.html
  '/index.html',
  '/auth0-spa-js.production.js',
  '/auth-init.js',
  '/guard-auth.js',
  '/style.css',
  '/favicon.ico',
  '/health',
  '/api/diag'
]);

// Helper: serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// Health endpoint for Render (very small and returns 200)
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Public diag endpoint used by client to check auth status
app.get('/api/diag', (req, res) => {
  // optional: if you use session cookies to indicate logged-in state, check here
  // For now, return 401 if no auth header or cookie - but to let the client detect "not-authenticated"
  try {
    // If you have a session cookie set by /auth/callback, you could check req.cookies here
    // Example:
    if (req.cookies && req.cookies['shree_session']) {
      return res.json({ ok: true, session: true });
    }
  } catch (e) { /* ignore */ }
  // Not authenticated — return 401 so client knows
  return res.status(401).json({ ok: false, error: 'Not authenticated' });
});

// Serve static files, but for each request verify if path is public first
app.use((req, res, next) => {
  // Normalize path (strip query)
  const pathname = req.path;

  // Allow any PUBLIC_PATHS to proceed to static handler without auth
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/public/') || pathname.startsWith('/assets/')) {
    return next();
  }

  // If request path starts with /api or /auth, skip here (handled later / separately)
  if (pathname.startsWith('/api') || pathname.startsWith('/auth')) {
    return next();
  }

  // For any other static file under STATIC_DIR, we want authentication:
  // But to avoid blocking static file serving for client-side resources we let the static handler run
  // and the client will call /api/diag to confirm auth status.
  return next();
});

// Static file handler (serves from backend/private)
app.use(express.static(staticRoot, {
  // Don't allow directory listing
  index: false,
  extensions: ['html', 'htm']
}));

// If someone requests a top-level .html that exists, express.static served it above.
// For missing file, fallback -> return 404 JSON for API, or redirect to index for SPA
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return next();
  // If request accept is html, send index
  if (req.accepts('html')) {
    return res.sendFile(path.join(staticRoot, 'index.html'));
  }
  return res.status(404).json({ error: 'Not found' });
});

// ---------------------
// JWT middleware (only for /api routes)
// ---------------------
if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  console.warn('AUTH0_DOMAIN or AUTH0_AUDIENCE not set. /api routes will be unprotected until configured.');
} else {
  // configure express-jwt to check Authorization: Bearer <token>
  const jwtMiddleware = jwt({
    // Dynamically provide a signing key based on the kid in the header and the signing keys provided by the JWKS endpoint.
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
    }),
    // Validate the audience and the issuer.
    audience: AUTH0_AUDIENCE,
    issuer: `https://${AUTH0_DOMAIN}/`,
    algorithms: ['RS256']
  });

  // Mount JWT middleware only for /api routes
  app.use('/api', (req, res, next) => {
    // We want /api/diag to remain public (it was handled above). If needed, you can exclude more.
    if (req.path === '/diag') return next();
    return jwtMiddleware(req, res, next);
  });
}

// ---------------------
// Example protected API routes under /api
// ---------------------
app.get('/api/list', (req, res) => {
  // req.auth will contain decoded JWT if jwt middleware ran
  // return list of photos (implement your drive/list logic here)
  // Placeholder:
  res.json({ ok: true, items: [] });
});

app.post('/api/upload', (req, res) => {
  // protected: handle upload (parse multipart/form-data etc.)
  res.json({ ok: true, message: 'upload endpoint (placeholder)' });
});

// ---------------------
// Auth endpoints (server side)
// Keep your existing implementation of /auth/login and /auth/callback
// ---------------------
app.get('/auth/login', (req, res) => {
  // If you use Auth0 hosted login redirect, send user to the Auth0 authorize URL here
  // Example minimal redirect (update with your client id, redirect URI):
  const authUrl = `https://${AUTH0_DOMAIN}/authorize?response_type=code&client_id=${encodeURIComponent(process.env.AUTH0_CLIENT_ID)}&redirect_uri=${encodeURIComponent(process.env.FRONTEND_ORIGIN || '') + '/auth/callback'}&scope=openid%20profile%20email&audience=${encodeURIComponent(AUTH0_AUDIENCE || '')}`;
  return res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  // your existing server logic should exchange code -> token, optionally create a server-side session cookie
  // Placeholder: show a minimal response (replace this with your production callback code)
  // Important: after successful callback, set an HttpOnly cookie (eg. shree_session) then redirect to /life.html
  try {
    // TODO: exchange req.query.code for tokens, validate user, set cookie...
    // temporary placeholder:
    res.cookie('shree_session', '1', { httpOnly: true, sameSite: 'lax' });
    return res.redirect('/life.html');
  } catch (err) {
    console.error('auth callback error', err);
    return res.status(500).send('Auth callback error');
  }
});

// -------------- Error handling --------------
app.use((err, req, res, next) => {
  // express-jwt UnauthorizedError handling
  if (err && err.name === 'UnauthorizedError') {
    return res.status(err.status || 401).json({ error: err.message || 'Unauthorized' });
  }
  console.error(err && err.stack ? err.stack : err);
  return res.status(500).json({ error: 'Server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Static files served from: ${staticRoot}`);
  console.log(`Server listening on port ${PORT}`);
});
