// backend/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

import checkJwt from "./auth-mw.js"; // default import (Auth0 middleware)
import { uploadBufferToDrive, streamFileFromDrive } from "./drive.js";

dotenv.config();

const app = express();
const upload = multer();
app.use(cors());
app.use(express.json());

const PHOTOS_DB = path.join(process.cwd(), "backend", "photos.json");

// ensure photos.json exists
async function ensurePhotosDb() {
  try {
    await fs.access(PHOTOS_DB);
  } catch {
    await fs.writeFile(PHOTOS_DB, JSON.stringify([]));
  }
}

async function readPhotos() {
  await ensurePhotosDb();
  const raw = await fs.readFile(PHOTOS_DB, "utf-8");
  return JSON.parse(raw || "[]");
}

async function writePhotos(arr) {
  await fs.writeFile(PHOTOS_DB, JSON.stringify(arr, null, 2));
}

// ✅ Root route (fix for Render splash/health check)
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend alive — use /api/diag" });
});

// Health check
app.get("/api/diag", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Upload (protected)
app.post("/api/upload", checkJwt, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const caption = req.body.caption || "";
    const uploader =
      req.auth && (req.auth.email || req.auth.sub)
        ? req.auth.email || req.auth.sub
        : "unknown";

    if (!file) return res.status(400).json({ error: "No file provided" });

    // Upload to Drive
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
    const uploadRes = await uploadBufferToDrive(
      file.buffer,
      file.originalname,
      file.mimetype,
      folderId
    );

    // Add metadata
    const photos = await readPhotos();
    const entry = {
      id: uploadRes.id,
      name: uploadRes.name,
      mimeType: uploadRes.mimeType,
      caption,
      uploader,
      createdAt: new Date().toISOString(),
    };
    photos.unshift(entry); // newest first
    await writePhotos(photos);

    res.json({ ok: true, file: entry });
  } catch (err) {
    console.error("upload error:", err);
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

// List (protected)
app.get("/api/list", checkJwt, async (req, res) => {
  try {
    const photos = await readPhotos();
    res.json(photos);
  } catch (err) {
    console.error("list error:", err);
    res.status(500).json({ error: "Failed to read list" });
  }
});

// Stream file (protected)
app.get("/api/file/:id", checkJwt, async (req, res) => {
  try {
    const fileId = req.params.id;
    await streamFileFromDrive(res, fileId);
  } catch (err) {
    console.error("file stream error:", err);
    if (!res.headersSent)
      res.status(500).json({ error: "Failed to stream file", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
