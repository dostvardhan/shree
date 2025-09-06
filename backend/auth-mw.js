// auth-mw.js
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import dotenv from 'dotenv';
dotenv.config();

const { AUTH0_DOMAIN, AUTH0_AUDIENCE } = process.env;

if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  console.warn('WARNING: AUTH0_DOMAIN or AUTH0_AUDIENCE not set in .env');
}

const client = jwksClient({
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

export function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = auth.split(' ')[1];
  const options = {
    audience: AUTH0_AUDIENCE,
    issuer: `https://${AUTH0_DOMAIN}/`,
    algorithms: ['RS256'],
  };

  jwt.verify(token, getKey, options, (err, decoded) => {
    if (err) {
      console.error('Token verify error:', err && err.message ? err.message : err);
      return res.status(401).json({ error: 'Invalid token', details: err && err.message });
    }
    req.auth = decoded; // attach claims
    next();
  });
}
