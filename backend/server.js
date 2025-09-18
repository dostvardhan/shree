// backend/server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");
const path = require("path");
const fs = require("fs");

const { uploadToDrive, listFiles, getFileStream } = require("./drive");
const { ALLOWED_USERS, AUTH0_DOMAIN, AUTH0_AUDIENCE } = process.env;

const app = express();
const PORT = process.env.PORT || 3000;

// middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());

// ✅ unprotected health check for Render (no JWT needed)
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Auth0 JWT middleware
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

// restrict by email
function checkAllowedUser(req, res, next) {
  const allowed = (ALLOWED_USERS || "").split(",");
  const email = req.auth?.["https://shree-drive/email"];
  if (!email || !allowed.includes(email)) {
    return res.status(403).json({ error: "Forbidden: user not allowed" });
  }
  next();
}

// API: health diag (protected)
app.get("/api/diag", checkJwt, checkAllowedUser, (req, res) => {
  res.json({ status: "ok", user: req.auth });
});

// API: upload
const upload = multer({ dest: "uploads/" });
app.post(
  "/api/upload",
  checkJwt,
  checkAllowedUser,
  upload.single("file"),
  async (req, res) => {
    try {
      const { caption } = req.body;
      const filePath = req.file.path;
      const fileName = req.file.originalname;

      const driveFile = await uploadToDrive(filePath, fileName);

      // save metadata
      const entry = {
        id: driveFile.id,
        caption,
        uploadedAt: new Date().toISOString(),
      };

      let photos = [];
      if (fs.existsSync("backend/photos.json")) {
        photos = JSON.parse(fs.readFileSync("backend/photos.json", "utf8"));
      }
      photos.push(entry);
      fs.writeFileSync(
        "backend/photos.json",
        JSON.stringify(photos, null, 2),
        "utf8"
      );

      res.json({ success: true, entry });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

// API: list photos
app.get("/api/list", checkJwt, checkAllowedUser, async (req, res) => {
  try {
    let photos = [];
    if (fs.existsSync("backend/photos.json")) {
      photos = JSON.parse(fs.readFileSync("backend/photos.json", "utf8"));
    }
    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: "Failed to list photos" });
  }
});

// API: stream file from Google Drive
app.get("/api/file/:id", checkJwt, checkAllowedUser, async (req, res) => {
  try {
    const stream = await getFileStream(req.params.id);
    stream.pipe(res);
  } catch (err) {
    console.error("File fetch error:", err);
    res.status(500).json({ error: "Failed to fetch file" });
  }
});

// protect static files under backend/private
function protectStatic(req, res, next) {
  if (req.path.startsWith("/api/") || req.path === "/health") return next(); // skip APIs + /health
  return checkJwt(req, res, (err) => {
    if (err) return res.status(401).json({ error: "Unauthorized" });
    checkAllowedUser(req, res, (err2) => {
      if (err2) return res.status(403).json({ error: "Forbidden" });
      next();
    });
  });
}

app.use(protectStatic);
const staticPath = path.join(__dirname, "private");
console.log("Static files served from:", staticPath);
app.use(express.static(staticPath));

// fallback 404
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// start
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
