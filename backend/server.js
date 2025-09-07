// backend/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { google } from "googleapis";
import { checkJwt } from "./auth-mw.js";

// --- setup
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_ROOT = path.resolve(__dirname, ".."); // repo root

// --- middlewares
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve static frontend files (index.html, life.html, etc.)
app.use(express.static(STATIC_ROOT));
app.get("/", (req, res) => {
  res.sendFile(path.join(STATIC_ROOT, "index.html"));
});

// fallback: serve file if exists, else 404
app.get("*", (req, res) => {
  const filePath = path.join(STATIC_ROOT, req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  return res.status(404).send("Not Found");
});

// --- Google Drive setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth2Client });

// --- multer setup
const upload = multer({ storage: multer.memoryStorage() });

// --- health check
app.get("/api/diag", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// --- upload endpoint
app.post("/api/upload", checkJwt, upload.single("photo"), async (req, res) => {
  try {
    const { caption } = req.body;
    const fileMeta = {
      name: req.file.originalname,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    };
    const media = {
      mimeType: req.file.mimetype,
      body: Buffer.from(req.file.buffer),
    };
    const file = await drive.files.create({
      resource: fileMeta,
      media,
      fields: "id",
    });

    // append metadata to photos.json
    const metaFile = path.join(__dirname, "photos.json");
    let photos = [];
    if (fs.existsSync(metaFile)) {
      photos = JSON.parse(fs.readFileSync(metaFile));
    }
    photos.push({ id: file.data.id, caption });
    fs.writeFileSync(metaFile, JSON.stringify(photos, null, 2));

    res.json({ ok: true, id: file.data.id });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- list endpoint
app.get("/api/list", checkJwt, (req, res) => {
  try {
    const metaFile = path.join(__dirname, "photos.json");
    let photos = [];
    if (fs.existsSync(metaFile)) {
      photos = JSON.parse(fs.readFileSync(metaFile));
    }
    res.json(photos);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- stream file endpoint
app.get("/api/file/:id", checkJwt, async (req, res) => {
  try {
    const { id } = req.params;
    const driveRes = await drive.files.get(
      { fileId: id, alt: "media" },
      { responseType: "stream" }
    );
    driveRes.data
      .on("error", (err) => {
        console.error("Drive stream error:", err.message);
        res.sendStatus(500);
      })
      .pipe(res);
  } catch (err) {
    console.error("File fetch error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
