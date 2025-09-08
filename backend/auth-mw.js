// backend/auth-mw.js
import { expressjwt as jwt } from "express-jwt";
import jwksRsa from "jwks-rsa";

// Middleware: verifies JWT from Auth0
const checkJwt = jwt({
  // fetch signing keys from Auth0 JWKS endpoint
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
  }),

  // verify audience + issuer
  audience: process.env.AUTH0_AUDIENCE,             // e.g. "https://shree-drive.onrender.com"
  issuer: `https://${process.env.AUTH0_DOMAIN}/`,   // e.g. "dev-zzhjbmtzoxtgoz31.us.auth0.com/"
  algorithms: ["RS256"]
});

export default checkJwt;
