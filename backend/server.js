// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { expressjwt } from "express-jwt";
import jwksRsa from "jwks-rsa";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// Auth0 Config
// ----------------------
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN; 
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || "https://shree-drive.onrender.com";
const ALLOWED_USERS = (process.env.ALLOWED_USERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!AUTH0_DOMAIN) {
  console.warn("⚠️ AUTH0_DOMAIN not set!");
}

const checkJwt = expressjwt({
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

// middleware: invite-only users
function checkAllowedUsers(req, res, next) {
  const email = req.auth && (req.auth.email || req.auth["https://shree/email"]);
  if (ALLOWED_USERS.length > 0 && email && !ALLOWED_USERS.includes(email)) {
    console.warn("🚫 Unauthorized email:", email);
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

// ----------------------
// Google OAuth helper
// ----------------------
async function getOauth2Client() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing Google OAuth env vars");
  }
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    "http://localhost:3000/oauth2callback"
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  await oauth2Client.getAccessToken(); // ensure refresh works
  return oauth2Client;
}

// ----------------------
// Routes
// ----------------------

// Public: health + drive check
app.get("/api/diag", async (req, res) => {
  let driveStatus = "not_checked";
  try {
    const oauth2Client = await getOauth2Client();
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const about = await drive.about.get({ fields: "user" });
    if (about.data && about.data.user) {
      driveStatus = "ok";
    } else {
      driveStatus = "no_user";
    }
  } catch (err) {
    console.error("Drive diag error:", err.message);
    driveStatus = "error";
  }
  res.json({ status: "ok", time: new Date().toISOString(), drive: driveStatus });
});

// All protected routes
app.use("/api", checkJwt, checkAllowedUsers);

// GET /api/list
app.get("/api/list", async (req, res) => {
  try {
    const filePath = path.join(process.cwd(), "backend", "photos.json");
    let items = [];
    try {
      const raw = await fs.readFile(filePath, "utf8");
      items = JSON.parse(raw);
      if (!Array.isArray(items)) items = [];
    } catch (err) {
      console.warn("[WARN] Could not read photos.json:", err.message);
      items = [];
    }
    return res.json({ ok: true, items });
  } catch (err) {
    console.error("Error in /api/list:", err.message);
    return res.status(500).json({ error: "Failed to read list" });
  }
});

// POST /api/upload
const upload = multer({ storage: multer.memoryStorage() });
app.post("/api/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no_file" });

    const oauth2Client = await getOauth2Client();
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const originalName = req.file.originalname || "upload.jpg";
    const mimeType = req.file.mimetype || "application/octet-stream";
    const fileIdLocal = uuidv4();
    const fileName = `${fileIdLocal}-${originalName}`;

    const driveRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: process.env.GOOGLE_DRIVE_FOLDER_ID
          ? [process.env.GOOGLE_DRIVE_FOLDER_ID]
          : undefined,
      },
      media: {
        mimeType,
        body: Buffer.from(req.file.buffer),
      },
      fields: "id, name, mimeType, size",
    });

    const gfile = driveRes.data;

    // Save metadata
    const photosPath = path.join(process.cwd(), "backend", "photos.json");
    let arr = [];
    try {
      const raw = await fs.readFile(photosPath, "utf8");
      arr = JSON.parse(raw || "[]");
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }

    const caption = (req.body.caption || "").trim();
    const entry = {
      id: gfile.id,
      caption,
      filename: gfile.name,
      createdAt: new Date().toISOString(),
      mimeType: gfile.mimeType,
      size: gfile.size,
    };

    arr.unshift(entry);
    await fs.writeFile(photosPath, JSON.stringify(arr, null, 2), "utf8");

    return res.json({ ok: true, item: entry });
  } catch (err) {
    console.error("Upload error:", err.message);
    const safe = { message: err.message };
    if (err.response && err.response.data) safe.google = err.response.data;
    return res.status(500).json({ error: "upload_failed", safe });
  }
});

// GET /api/file/:id
app.get("/api/file/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    if (!fileId) return res.status(400).json({ error: "missing_fileId" });

    const oauth2Client = await getOauth2Client();
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    const meta = await drive.files.get({ fileId, fields: "id, name, mimeType" });
    const mimeType = meta.data.mimeType || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);

    const driveStream = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    driveStream.data.on("error", (err) => {
      console.error("Drive stream error:", err.message);
      res.status(500).end("Drive stream failed");
    });

    driveStream.data.pipe(res);
  } catch (err) {
    console.error("Error in /api/file/:id:", err.message);
    return res.status(500).json({ error: "file_stream_failed", message: err.message });
  }
});

// ----------------------
