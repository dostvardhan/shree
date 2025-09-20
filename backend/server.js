// server.js
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---- ENV VARS ----
const {
  PORT = 4000,
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET,
  AUTH0_REDIRECT_URI,
  AUTH0_AUDIENCE,
  SESSION_SECRET,
  FRONTEND_ORIGIN,
  ALLOWED_USERS = ''
} = process.env;

if (
  !AUTH0_DOMAIN ||
  !AUTH0_CLIENT_ID ||
  !AUTH0_CLIENT_SECRET ||
  !AUTH0_REDIRECT_URI ||
  !AUTH0_AUDIENCE ||
  !SESSION_SECRET
) {
  console.error('❌ Missing required env vars');
  process.exit(1);
}

// ---- EXPRESS SESSION ----
app.use(
  session({
    name: 'shree_session',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true, // must be true in production (HTTPS)
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// ---- STATIC FILES ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- HELPERS ----
const allowedSet = new Set(
  ALLOWED_USERS.split(',').map((s) => s.trim()).filter(Boolean)
);

function createSessionToken(payload) {
  return jwt.sign(payload, SESSION_SECRET, {
    algorithm: 'HS256',
    expiresIn: '12h'
  });
}
function verifySessionToken(token) {
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch (err) {
    return null;
  }
}
function requireAuth(req, res, next) {
  const token = req.cookies['shree_session'];
  if (!token) return res.redirect('/index.html');
  const user = verifySessionToken(token);
  if (!user) {
    res.clearCookie('shree_session');
    return res.redirect('/index.html');
  }
  req.user = user;
  next();
}

// ---- AUTH ROUTES ----
app.get('/auth/login', (req, res) => {
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH0_CLIENT_ID,
    redirect_uri: AUTH0_REDIRECT_URI,
    scope: 'openid profile email',
    audience: AUTH0_AUDIENCE,
    state
  });
  const url = `https://${AUTH0_DOMAIN}/authorize?${params.toString()}`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');

    const tokenResp = await axios.post(
      `https://${AUTH0_DOMAIN}/oauth/token`,
      {
        grant_type: 'authorization_code',
        client_id: AUTH0_CLIENT_ID,
        client_secret: AUTH0_CLIENT_SECRET,
        code,
        redirect_uri: AUTH0_REDIRECT_URI
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const { id_token } = tokenResp.data;
    const decoded = jwt.decode(id_token);
    const userEmail = decoded && decoded.email;
    if (!userEmail) return res.status(400).send('No email in token');

    if (allowedSet.size > 0 && !allowedSet.has(userEmail)) {
      return res.status(403).send('User not allowed');
    }

    const sessionToken = createSessionToken({
      email: userEmail,
      name: decoded.name || '',
      sub: decoded.sub
    });

    res.cookie('shree_session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.redirect('/life.html');
  } catch (err) {
    console.error('Auth callback error:', err.response ? err.response.data : err.message);
    res.status(500).send('Authentication failed');
  }
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('shree_session');
  const returnTo = encodeURIComponent(FRONTEND_ORIGIN || '/');
  const logoutUrl = `https://${AUTH0_DOMAIN}/v2/logout?client_id=${AUTH0_CLIENT_ID}&returnTo=${returnTo}`;
  res.redirect(logoutUrl);
});

// ---- PROTECTED STATIC PAGES ----
app.get(
  ['/life.html', '/upload.html', '/gallery.html', '/photo1.html', '/photo2.html', '/photo3.html', '/photo4.html', '/photo5.html', '/photo6.html', '/photo7.html', '/photo8.html', '/photo9.html'],
  requireAuth,
  (req, res) => {
    res.sendFile(path.join(__dirname, 'public', req.path));
  }
);

// ---- API STUBS ----
app.post('/api/upload', requireAuth, async (req, res) => {
  res.json({ ok: true, message: 'Upload endpoint stub' });
});

app.get('/api/list', requireAuth, async (req, res) => {
  res.json([]); // stub
});

app.get('/api/file/:id', requireAuth, async (req, res) => {
  res.status(501).send('Not implemented');
});

app.get('/api/diag', (req, res) =>
  res.json({ status: 'ok', ts: Date.now() })
);

// ---- HEALTH CHECK ----
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    ts: Date.now()
  });
});

// ---- START SERVER ----
const port = process.env.PORT || PORT;
const server = app.listen(port, () => {
  console.log(`✅ Server listening on port ${port}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`Received ${signal}. Closing server...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Force exit.');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
