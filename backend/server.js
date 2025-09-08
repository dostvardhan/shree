// backend/server.js
// ESM style server that serves static frontend from backend/ and exposes API endpoints.

import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { google } from "googleapis";
import { checkJwt } from "./auth-mw.js"; // ensure auth-mw.js exports checkJwt

// load env
dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

// determine __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// STATIC_ROOT is backend folder (we serve files from backend/)
const STATIC_ROOT = path.resolve(__dirname);

// middlewares
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve static files (index.html, css, js, photos etc.)
app.use(express.static(STATIC_ROOT));

// explicit root route -> index.html in backend/
app.get("/", (req, res) => {
  res.sendFile(path.join(STATIC_ROOT, "index.html"));
});

// fallback: if file exists serve it, otherwise 404
app.get("*", (req, res, next) => {
  const requested = path.join(STATIC_ROOT, req.path);
  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return res.sendFile(requested);
  }
  // If request looks like API, pass to next (so API routes can run)
  if (req.path.startsWith("/api/")) return next();
  // otherwise 404 HTML/text
  return res.status(404).send("Not Found");
});

// Google Drive setup (ensure env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID)
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID || "",
  process.env.GOOGLE_CLIENT_SECRET || "",
  process.env.REDIRECT_URI || ""
);

if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}
const drive = google.drive({ version: "v3", auth: oauth2Client });

// multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

// --- simple health check
app.get("/api/diag", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- upload endpoint (Auth guarded)
app.post("/api/upload", checkJwt, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const fileMeta = {
      name: req.file.originalname,
      parents: process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : undefined,
    };

    const media = {
      mimeType: req.file.mimetype,
      body: Buffer.from(req.file.buffer),
    };

    const result = await drive.files.create({
      requestBody: fileMeta,
      media,
      fields: "id,name,mimeType,webViewLink",
    });

    // persist a small meta file locally (optional)
    const metaFile = path.join(__dirname, "photos.json");
    let photos = [];
    if (fs.existsSync(metaFile)) {
      try { photos = JSON.parse(fs.readFileSync(metaFile, "utf8") || "[]"); } catch(e) { photos = []; }
    }
    photos.push({ id: result.data.id, name: result.data.name || req.file.originalname, caption: req.body.caption || "" });
    fs.writeFileSync(metaFile, JSON.stringify(photos, null, 2));

    res.json({ ok: true, id: result.data.id, meta: result.data });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// --- list endpoint (Auth guarded)
app.get("/api/list", checkJwt, (req, res) => {
  try {
    const metaFile = path.join(__dirname, "photos.json");
    let photos = [];
    if (fs.existsSync(metaFile)) {
      photos = JSON.parse(fs.readFileSync(metaFile, "utf8") || "[]");
    }
    res.json({ ok: true, photos });
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// --- stream file from Google Drive (Auth guarded)
app.get("/api/file/:id", checkJwt, async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ ok: false, error: "Missing file id" });

  try {
    const driveRes = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "stream" });
    driveRes.data.on("error", (err) => {
      console.error("Drive stream error:", err);
      try { res.sendStatus(500); } catch (e) {}
    }).pipe(res);
  } catch (err) {
    console.error("File fetch error:", err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
