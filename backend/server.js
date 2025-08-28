// server.js — Private-only: JWT-gated streaming from Google Drive
if (!origin) return cb(null, true); // curl / diag
const ok = ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN;
cb(ok ? null : new Error('CORS: origin not allowed: ' + origin), ok);
},
methods: ['GET', 'POST', 'OPTIONS'],
allowedHeaders: ['Content-Type', 'Authorization'],
maxAge: 86400,
}));


// --- Google Drive OAuth2 ---
const oAuth2Client = new google.auth.OAuth2(
process.env.CLIENT_ID,
process.env.CLIENT_SECRET,
process.env.REDIRECT_URI
);


oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oAuth2Client });


// --- Multer (memory) ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });


// --- Netlify Identity Dual-Issuer JWT Verify ---
const ISS1 = (process.env.NETLIFY_ISSUER_1 || '').replace(/\/$/, '');
const ISS2 = (process.env.NETLIFY_ISSUER_2 || '').replace(/\/$, '');
const AUD = (process.env.NETLIFY_JWT_AUD || '').trim();


function jwksUriForIssuer(iss) {
const base = iss.replace(/\/$/, '');
return `${base}/.well-known/jwks.json`;
}


const jwksClients = {};
function getClientForIssuer(iss) {
const key = iss.replace(/\/$/, '');
if (!jwksClients[key]) {
jwksClients[key] = jwksClient({
jwksUri: jwksUriForIssuer(key),
cache: true,
cacheMaxEntries: 5,
cacheMaxAge: 10 * 60 * 1000,
rateLimit: true,
jwksRequestsPerMinute: 10,
});
}
return jwksClients[key];
}


async function verifyNetlifyJWT(authHeader) {
if (!authHeader ||
