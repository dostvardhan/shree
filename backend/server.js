// backend/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(__dirname, "uploads");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// serve static files from repo root
app.use(express.static(REPO_ROOT));
app.get("/", (req, res) => {
  const idx = path.join(REPO_ROOT, "index.html");
  if (fs.existsSync(idx)) return res.sendFile(idx);
  res.type("text").send("Shree backend running — no index.html at repo root.");
});

app.get("/diag", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
app.get("/healthz", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN; // e.g. dev-xxxx.us.auth0.com
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

let jwks = null;
if (AUTH0_DOMAIN) {
  jwks = jwksClient({ jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json` });
} else {
  console.warn("AUTH0_DOMAIN not set — protected endpoints will reject tokens.");
}
function getKey(header, callback) {
  if (!jwks) return callback(new Error("JWKS not configured"));
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const pub = key.getPublicKey();
    callback(null, pub);
  });
}
function checkJwt(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: "Missing Authorization" });
  const token = h.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Malformed Authorization" });

  jwt.verify(
    token,
    getKey,
    {
      issuer: AUTH0_DOMAIN ? `https://${AUTH0_DOMAIN}/` : undefined,
      audience: AUTH0_AUDIENCE,
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) {
        console.warn("JWT verify failed:", err && err.message);
        return res.status(401).json({ error: "Invalid token", details: err && err.message });
      }
      req.user = decoded;
      next();
    }
  );
}

let drive = null;
try {
  const oauth2Client = new google.auth.OAuth2();
  if (process.env.REFRESH_TOKEN) {
    oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
    drive = google.drive({ version: "v3", auth: oauth2Client });
  }
} catch (e) {
  console.warn("Google Drive init error:", e && e.message);
}

const upload = multer({ dest: UPLOAD_DIR });

app.post("/upload", checkJwt, upload.single("file"), async (req, res) => {
  if (!drive) {
    if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch(_) {}
    return res.status(500).json({ error: "Drive not configured" });
  }
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  try {
    const meta = { name: req.file.originalname };
    if (process.env.DRIVE_FOLDER_ID) meta.parents = [process.env.DRIVE_FOLDER_ID];
    const media = { mimeType: req.file.mimetype, body: fs.createReadStream(req.file.path) };
    const r = await drive.files.create({ resource: meta, media, fields: "id,name,mimeType" });
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json({ id: r.data.id, name: r.data.name });
  } catch (err) {
    console.error("upload error:", err && err.message);
    res.status(500).json({ error: err && err.message });
  }
});

app.get("/list", checkJwt, async (req, res) => {
  if (!drive) return res.status(500).json({ error: "Drive not configured" });
  try {
    const q = process.env.DRIVE_FOLDER_ID ? `'${process.env.DRIVE_FOLDER_ID}' in parents` : undefined;
    const r = await drive.files.list({ q, fields: "files(id,name,mimeType,description)", pageSize: 200 });
    res.json({ files: r.data.files || [] });
  } catch (e) {
    console.error("list error:", e && e.message);
    res.status(500).json({ error: e && e.message });
  }
});

app.get("/file/:id", checkJwt, async (req, res) => {
  if (!drive) return res.status(500).json({ error: "Drive not configured" });
  try {
    const g = await drive.files.get({ fileId: req.params.id, alt: "media" }, { responseType: "stream" });
    res.setHeader("Content-Type", (g.headers && g.headers["content-type"]) || "application/octet-stream");
    g.data.pipe(res);
  } catch (e) {
    console.error("file fetch error:", e && e.message);
    res.status(500).json({ error: e && e.message });
  }
});

process.on("uncaughtException", (err) => console.error("UNCAUGHT:", err && err.stack || err));
process.on("unhandledRejection", (r) => console.error("UNHANDLED REJECTION:", r));

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT} (pid ${process.pid})`);
});
