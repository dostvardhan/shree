// backend/server.js
// ESM-style server: Auth0 JWT verification (JWKS), Google Drive uploads, metadata in photos.json
import express from "express";
import multer from "multer";
import cors from "cors";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// compute __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- Allowed users (from env, comma-separated) -----
const DEFAULT_ALLOWED = [
  "mitravardhan@gmail.com",
  "dostvardhan@gmail.com",
  "jhilmilsiyaadein@gmail.com"
];
const ALLOWED_USERS = (process.env.ALLOWED_USERS && process.env.ALLOWED_USERS.split(",").map(s => s.trim()).filter(Boolean)) || DEFAULT_ALLOWED;

// ----- CORS origins -----
const rawOrigins = process.env.FRONTEND_ORIGIN || "";
const ORIGINS = rawOrigins.split(",").map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin: ORIGINS.length ? ORIGINS : true,
  optionsSuccessStatus: 204
};

// ----- Auth0 JWKS setup -----
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

let jwks;
if (AUTH0_DOMAIN) {
  jwks = jwksClient({
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true
  });
} else {
  console.warn("AUTH0_DOMAIN not set in env; JWT verification will fail until configured.");
}

function getKeyFromHeader(header) {
  return new Promise((resolve, reject) => {
    if (!jwks) return reject(new Error("JWKS client not configured"));
    const kid = header.kid;
    jwks.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      const signingKey = key.getPublicKey ? key.getPublicKey() : key.publicKey || key.rsaPublicKey;
      resolve(signingKey);
    });
  });
}

async function verifyJWTMiddleware(req, res, next) {
  try {
    const authHeader = (req.headers.authorization || "");
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing or invalid Authorization header" });

    const token = authHeader.split(" ")[1];
    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
      return res.status(401).json({ error: "Invalid token (missing kid)" });
    }

    const pubKey = await getKeyFromHeader(decodedHeader.header);
    const payload = jwt.verify(token, pubKey, {
      algorithms: ["RS256"],
      audience: AUTH0_AUDIENCE,
      issuer: `https://${AUTH0_DOMAIN}/`
    });

    // Extract a candidate email from the token payload
    const email = payload.email || payload["https://shree.example/email"] || payload["https://example.com/email"] || payload.sub;

    if (!email || !ALLOWED_USERS.includes(email)) {
      return res.status(403).json({ error: "Access denied: not invited" });
    }

    req.user = payload;
    next();
  } catch (err) {
    console.error("JWT verify error:", err && err.message ? err.message : err);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ----- Google Drive setup -----
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob"
);

if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
} else {
  console.warn("GOOGLE_REFRESH_TOKEN missing — Drive uploads will fail until set.");
}

const drive = google.drive({ version: "v3", auth: oauth2Client });

// ----- metadata file (photos.json) next to server.js -----
const METADATA_FILE = path.join(__dirname, "photos.json");
const METADATA_DIR = path.dirname(METADATA_FILE);
if (!fs.existsSync(METADATA_DIR)) fs.mkdirSync(METADATA_DIR, { recursive: true });
if (!fs.existsSync(METADATA_FILE)) fs.writeFileSync(METADATA_FILE, "[]", "utf8");

// ----- Multer (memory storage) -----
const upload = multer({ storage: multer.memoryStorage() });

// ----- Middleware -----
app.use(cors(corsOptions));
app.use(express.json());

// ----- Routes -----

// healthcheck
app.get("/api/diag", (req, res) => res.json({ status: "ok" }));

// upload: requires JWT, accepts multipart/form-data field "file" & optional "caption"
app.post("/api/upload", verifyJWTMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const caption = (req.body.caption || "").toString();
    const originalName = req.file.originalname || "file";
    const timestamped = `${Date.now()}-${originalName}`;
    const parents = process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : [];

    // create file on Drive
    const media = { mimeType: req.file.mimetype, body: Buffer.from(req.file.buffer) };

    const driveRes = await drive.files.create({
      resource: { name: timestamped, parents },
      media,
      fields: "id, mimeType"
    });

    const fileId = driveRes.data.id;
    const entry = {
      id: fileId,
      filename: originalName,
      caption,
      uploadedAt: new Date().toISOString()
    };

    // store metadata (prepend newest)
    const arr = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8") || "[]");
    arr.unshift(entry);
    fs.writeFileSync(METADATA_FILE, JSON.stringify(arr, null, 2), "utf8");

    res.json({ success: true, ...entry });
  } catch (err) {
    console.error("Upload error:", err && err.message ? err.message : err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// list uploads (requires JWT)
app.get("/api/list", verifyJWTMiddleware, (req, res) => {
  try {
    const arr = JSON.parse(fs.readFileSync(METADATA_FILE, "utf8") || "[]");
    res.json(arr);
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ error: "Could not list photos" });
  }
});

// stream file from Drive (requires JWT)
app.get("/api/file/:id", verifyJWTMiddleware, async (req, res) => {
  try {
    const fileId = req.params.id;
    // get mimeType
    const meta = await drive.files.get({ fileId, fields: "mimeType" });
    const mime = meta.data.mimeType || "application/octet-stream";
    res.setHeader("Content-Type", mime);

    const driveRes = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
    driveRes.data.pipe(res);
  } catch (err) {
    console.error("File stream error:", err && err.message ? err.message : err);
    res.status(500).json({ error: "Could not fetch file" });
  }
});

// optional: serve a simple root message
app.get("/", (req, res) => {
  res.send("shree backend — /api/diag");
});

// ----- start -----
app.listen(PORT, () => {
  console.log(`✅ Backend listening on port ${PORT}`);
});
