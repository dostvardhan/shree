// server.js (improved, robust)
import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { google } from "googleapis";
import fs from "fs";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json());

// --- Basic startup logging
console.log("Starting Shree backend...");
console.log("NODE_ENV:", process.env.NODE_ENV || "undefined");
console.log("PORT:", PORT);

// === Auth0 / JWT verification setup (if using Auth0)
const jwksUri = process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json` : null;
let jwksClientInstance = null;
if (jwksUri) {
  jwksClientInstance = jwksClient({ jwksUri });
} else {
  console.warn("AUTH0_DOMAIN not set — JWT verification will fail if called.");
}

function getKey(header, callback) {
  if (!jwksClientInstance) return callback(new Error("JWKS client not configured"));
  jwksClientInstance.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    try {
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    } catch (e) {
      callback(e);
    }
  });
}

function checkJwt(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing Authorization header" });
  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Malformed Authorization header" });

  jwt.verify(
    token,
    getKey,
    {
      audience: process.env.AUTH0_AUDIENCE,
      issuer: process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}/` : undefined,
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) {
        console.warn("JWT verify error:", err && err.message);
        return res.status(401).json({ error: "Invalid token", details: err && err.message });
      }
      req.user = decoded;
      next();
    }
  );
}

// === Google Drive setup (if used) ===
let drive = null;
try {
  const oauth2Client = new google.auth.OAuth2();
  if (process.env.REFRESH_TOKEN) {
    oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
    drive = google.drive({ version: "v3", auth: oauth2Client });
  } else {
    console.warn("REFRESH_TOKEN not set — Google Drive operations disabled.");
  }
} catch (e) {
  console.error("Google APIs init error:", e && e.message);
}

// === Multer temp upload dir ===
const UPLOAD_DIR = "backend/uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); }
  catch (e) { console.warn("Could not create upload dir:", e && e.message); }
}
const upload = multer({ dest: UPLOAD_DIR });

// --- Health / root routes ---
app.get("/", (req, res) => {
  res.type("text").send("✅ Shree backend is live. Use /upload, /list, /file/:id");
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), time: new Date().toISOString() });
});

// --- Upload endpoint ---
app.post("/upload", checkJwt, upload.single("file"), async (req, res) => {
  if (!drive) {
    // cleanup uploaded file
    if (req?.file?.path) try { fs.unlinkSync(req.file.path); } catch(_) {}
    return res.status(500).json({ error: "Google Drive not configured" });
  }
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  try {
    const fileMetadata = {
      name: req.file.originalname,
      parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined,
    };
    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };
    const r = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id, name, mimeType",
    });

    // remove temp file
    try { fs.unlinkSync(req.file.path); } catch (e) { console.warn("unlink temp failed:", e && e.message); }

    res.json({ id: r.data.id, name: r.data.name });
  } catch (err) {
    console.error("Upload error:", err && err.message);
    res.status(500).json({ error: err && err.message });
  }
});

// --- List files ---
app.get("/list", checkJwt, async (req, res) => {
  if (!drive) return res.status(500).json({ error: "Google Drive not configured" });
  try {
    const response = await drive.files.list({
      q: process.env.DRIVE_FOLDER_ID ? `'${process.env.DRIVE_FOLDER_ID}' in parents` : undefined,
      fields: "files(id, name, mimeType, description)",
      pageSize: 100,
    });
    res.json({ files: response.data.files || [] });
  } catch (err) {
    console.error("List error:", err && err.message);
    res.status(500).json({ error: err && err.message });
  }
});

// --- Serve file by ID ---
app.get("/file/:id", checkJwt, async (req, res) => {
  if (!drive) return res.status(500).json({ error: "Google Drive not configured" });
  const fileId = req.params.id;
  try {
    const driveRes = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
    // set a generous content-type if present
    res.setHeader("Content-Type", driveRes.headers && driveRes.headers["content-type"] ? driveRes.headers["content-type"] : "application/octet-stream");
    driveRes.data.pipe(res);
  } catch (err) {
    console.error("File fetch error:", err && err.message);
    res.status(500).json({ error: err && err.message });
  }
});

// --- Global error handlers and process watchers ---
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err && err.stack || err);
  // don't exit immediately; let Render restart if necessary
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason && reason.stack || reason);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT} (pid ${process.pid})`);
});
