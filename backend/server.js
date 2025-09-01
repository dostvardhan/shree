// Identity JWT verify (RS256 via JWKS)
const jwks = jwksClient({ jwksUri: JWKS_URI, cache: true, cacheMaxAge: 10 * 60 * 1000, rateLimit: true });
function getKey(header, cb) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return cb(err);
    cb(null, key.getPublicKey());
  });
}
function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(
