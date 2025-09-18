// backend/server.js
// Full server with:
// - unprotected /health endpoint for Render
// - index.html + auth scripts allowed publicly so users can login
// - all other static files protected by Auth0 JWT + allowed-users check
// - simple upload/list/file endpoints that require JWT
// - google-drive helpers are required from ./drive (assumed present)

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");

// Auth0 JWT
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");

// Drive helpers (your existing implementation)
const { uploadToDrive, listFiles, getFileStream } = require("./drive");

// envs (set these on Render)
const {
  AUTH0_DOMAIN,
  AUTH0_AUDIENCE,
  ALLOWED_USERS = "",
  PORT = 4000,
} = process.env;

const app = express();
const APP_PORT = process.env.PORT || PORT || 4000;

// basic middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());

// --------------------
// PUBLIC / HEALTH
// --------------------
// public health check (Render uses this)
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// --------------------
// AUTH0 JWT SETUP
// --------------------
if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  console.warn(
    "AUTH0_DOMAIN or AUTH0_AUDIENCE not set. Protected endpoints will fail without these env vars."
  );
}

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  }),
  audience: AUTH0_AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  algorithms: ["RS256"],
});

// helper: allowed users by email (comma-separated)
function checkAllowedUser(req, res, next) {
  try {
    const allowed = (ALLOWED_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);
    // try to read email from standard claims
    const email =
      (req.auth && (req.auth.email || req.auth["email"])) ||
      (req.auth && req.auth["https://shree-drive/email"]) ||
      (req.auth && req.auth["https://example.com/email"]); // fallback if you used custom claim
    if (!allowed.length) {
      // no allowed list set — deny by default
      return res.status(403).json({ error: "Forbidden: no allowed users configured" });
    }
    if (!email || !allowed.includes(email)) {
      return res.status(403).json({ error: "Forbidden: user not allowed" });
    }
    next();
  } catch (err) {
    console.error("checkAllowedUser error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// --------------------
// API ROUTES (protected)
// --------------------
const upload = multer({ dest: "uploads/" });

app.get("/api/diag", checkJwt, checkAllowedUser, (req, res) => {
  res.json({ status: "ok", user: req.auth || null });
});

app.post(
  "/api/upload",
  checkJwt,
  checkAllowedUser,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const caption = req.body.caption || "";
      const filepath = req.file.path;
      const filename = req.file.originalname;

      // uploadToDrive should return an object with id, name, etc.
      const driveFile = await uploadToDrive(filepath, filename);

      // persist metadata in backend/photos.json
      const entry = {
        id: driveFile.id,
        name: driveFile.name || filename,
        caption,
        uploadedAt: new Date().toISOString(),
      };

      const metaPath = path.join(__dirname, "photos.json");
      let photos = [];
      if (fs.existsSync(metaPath)) {
        photos = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      }
      photos.push(entry);
      fs.writeFileSync(metaPath, JSON.stringify(photos, null, 2), "utf8");

      // remove local uploaded file
      fs.unlink(filepath, () => {});

      res.json({ success: true, entry });
    } catch (err) {
      console.error("upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

app.get("/api/list", checkJwt, checkAllowedUser, async (req, res) => {
  try {
    const metaPath = path.join(__dirname, "photos.json");
    let photos = [];
    if (fs.existsSync(metaPath)) {
      photos = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    }
    res.json(photos);
  } catch (err) {
    console.error("list error:", err);
    res.status(500).json({ error: "Failed to list photos" });
  }
});

app.get("/api/file/:id", checkJwt, checkAllowedUser, async (req, res) => {
  try {
    const stream = await getFileStream(req.params.id);
    stream.pipe(res);
  } catch (err) {
    console.error("file fetch error:", err);
    res.status(500).json({ error: "Failed to fetch file" });
  }
});

// --------------------
// PROTECT STATIC FILES
// --------------------
// Serve static files from backend/private but allow index + auth scripts publicly
const staticPath = path.join(__dirname, "private");
console.log("Static files served from:", staticPath);

// protect middleware: allow /health and API, allow specific public assets (index + auth scripts)
function protectStatic(req, res, next) {
  // allow APIs and health
  if (req.path.startsWith("/api/") || req.path === "/health") return next();

  // allow public login assets: index and auth scripts + favicon
  const publicPaths = [
    "/",
    "/index.html",
    "/favicon.ico",
    "/auth-init.js",
    "/auth0-spa-js.production.js",
    "/guard-auth.js",
    "/style.css", // if index needs css publicly — OPTIONAL: remove if you want css protected until login
  ];
  if (publicPaths.includes(req.path)) {
    return next();
  }

  // otherwise require JWT + allowed user
  return checkJwt(req, res, (err) => {
    if (err) {
      // express-jwt gives an UnauthorizedError object
      return res.status(401).json({ error: "Unauthorized" });
    }
    checkAllowedUser(req, res, (err2) => {
      if (err2) {
        // checkAllowedUser already sends response, but guard fallback
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    });
  });
}

app.use(protectStatic);
app.use(express.static(staticPath));

// fallback 404 for other routes
app.use((req, res) => {
  // If it's an HTML request, give a JSON 404 (we keep API style)
  res.status(404).json({ error: "Not Found" });
});

// start server
app.listen(APP_PORT, () => {
  console.log(`Server listening on port ${APP_PORT}`);
});
