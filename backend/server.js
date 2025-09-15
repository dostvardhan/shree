// backend/server.js (CommonJS) - Drive upload + Auth0 JWT + list + stream
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const jwksClient = require("jwks-rsa");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;

// ---------- Config ----------
const PHOTOS_FILE = path.join(__dirname, "photos.json");
if (!fs.existsSync(PHOTOS_FILE)) fs.writeFileSync(PHOTOS_FILE, "[]", "utf8");

const ALLOWED_USERS = (process.env.ALLOWED_USERS || "").split(",").map(s => s.trim()).filter(Boolean);
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN; // e.g. dev-zzhjbmtzoxtgoz31.us.auth0.com
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE; // e.g. https://shree-drive.onrender.com
const MAKE_PUBLIC = String(process.env.MAKE_PUBLIC || "false").toLowerCase() === "true";

if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE) {
  console.warn("AUTH0_DOMAIN or AUTH0_AUDIENCE not set — JWT verification will fail until set.");
}

// ---------- Google Drive setup ----------
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob"
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth2Client });

// ---------- Helpers for photos.json ----------
function readPhotos() {
  try {
    const raw = fs.readFileSync(PHOTOS_FILE, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    console.error("readPhotos error:", e);
    return [];
  }
}
function appendPhoto(entry) {
  try {
    const arr = readPhotos();
    arr.unshift(entry); // newest first
    fs.writeFileSync(PHOTOS_FILE, JSON.stringify(arr, null, 2), "utf8");
  } catch (e) {
    console.error("appendPhoto error:", e);
  }
}

// ---------- Multer (memory) for Drive uploads ----------
const upload = multer({ storage: multer.memoryStorage() });

// ---------- Auth0 JWT middleware ----------
let jwks;
if (AUTH0_DOMAIN) {
  jwks = jwksClient({
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true
  });
}

async function verifyJWTMiddleware(req, res, next) {
  try {
    const auth = (req.headers.authorization || "").split(" ");
    if (auth.length !== 2 || auth[0] !== "Bearer") {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    const token = auth[1];

    if (!jwks) return res.status(500).json({ error: "Auth config not set" });

    // get kid from token header
    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
      return res.status(401).json({ error: "Invalid token (no kid)" });
    }

    const key = await jwks.getSigningKey(decodedHeader.header.kid);
    const publicKey = key.getPublicKey ? key.getPublicKey() : key.publicKey || key.rsaPublicKey;

    // verify
    const payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      audience: AUTH0_AUDIENCE,
      issuer: `https://${AUTH0_DOMAIN}/`
    });

    // ALLOWED_USERS check (if configured)
    if (ALLOWED_USERS.length > 0) {
      const email = payload.email || (payload["https://example.com/email"]) || payload["sub"];
      // allow if email is present and in ALLOWED_USERS, otherwise block
      if (!email || !ALLOWED_USERS.includes(email)) {
        return res.status(403).json({ error: "User not allowed" });
      }
    }

    // attach user info
    req.user = payload;
    next();
  } catch (err) {
    console.error("verifyJWT error:", err && err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ---------- Routes ----------

// Health
app.get("/api/diag", (req, res) => res.json({ status: "ok" }));

// Upload -> Google Drive
app.post("/api/upload", verifyJWTMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const caption = (req.body.caption || "").toString();
    const name = Date.now() + "-" + req.file.originalname;
    const parents = process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : [];

    const fileMetadata = { name, parents };
    const media = { mimeType: req.file.mimetype, body: Buffer.from(req.file.buffer) };

    // Upload
    const driveRes = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id,mimeType"
    });

    const fileId = driveRes.data.id;
    // optionally make public (if MAKE_PUBLIC true)
    if (MAKE_PUBLIC) {
      try {
        await drive.permissions.create({
          fileId,
          requestBody: { role: "reader", type: "anyone" }
        });
      } catch (permErr) {
        console.warn("Could not make file public:", permErr && permErr.message);
      }
    }

    const entry = {
      id: fileId,
      filename: req.file.originalname,
      caption,
      uploadedAt: new Date().toISOString()
    };
    appendPhoto(entry);

    res.json({ success: true, ...entry });
  } catch (err) {
    console.error("Upload error:", err && (err.message || err));
    res.status(500).json({ error: "Upload failed" });
  }
});

// List
app.get("/api/list", verifyJWTMiddleware, (req, res) => {
  const arr = readPhotos();
  res.json(arr);
});

// Stream file from Drive securely
app.get("/api/file/:id", verifyJWTMiddleware, async (req, res) => {
  try {
    const fileId = req.params.id;
    // get file metadata for content-type
    const meta = await drive.files.get({ fileId, fields: "mimeType" });
    const mime = meta.data.mimeType || "application/octet-stream";
    res.setHeader("Content-Type", mime);

    const driveRes = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
    driveRes.data.pipe(res);
  } catch (err) {
    console.error("File stream error:", err && err.message);
    res.status(500).json({ error: "Could not fetch file" });
  }
});

// Serve a simple root message
app.get("/", (req, res) => {
  res.send("shree backend - /api/upload (POST), /api/list, /api/file/:id, /api/diag");
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
