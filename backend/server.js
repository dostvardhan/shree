// backend/server.js
import express from "express";
import multer from "multer";
import cors from "cors";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

// ===== Allowed Users (only these emails can access) =====
const ALLOWED_USERS = [
  "mitravardhan@gmail.com",
  "dostvardhan@gmail.com",
  "jhilmilsiyaadein@gmail.com"
];

// ===== Auth0 JWT Verification =====
const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function verifyJWTMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  jwt.verify(
    token,
    getKey,
    {
      audience: process.env.AUTH0_AUDIENCE,
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      algorithms: ["RS256"]
    },
    (err, payload) => {
      if (err) return res.status(401).json({ error: "Invalid token" });

      // ✅ Only allow invited users
      if (!ALLOWED_USERS.includes(payload.email)) {
        return res.status(403).json({ error: "Access denied: not invited" });
      }

      req.user = payload;
      next();
    }
  );
}

// ===== Multer (local temp upload before sending to Drive) =====
const upload = multer({ dest: "uploads/" });

// ===== Google Drive Setup =====
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth2Client });

const METADATA_FILE = path.join(process.cwd(), "backend", "photos.json");
if (!fs.existsSync(METADATA_FILE)) fs.writeFileSync(METADATA_FILE, "[]");

// ===== Routes =====

// Health check
app.get("/api/diag", (req, res) => {
  res.json({ status: "ok" });
});

// Upload photo + caption
app.post("/api/upload", verifyJWTMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const caption = req.body.caption || "";
    const fileMetadata = { name: req.file.originalname, parents: [process.env.DRIVE_FOLDER_ID] };
    const media = { mimeType: req.file.mimetype, body: fs.createReadStream(req.file.path) };

    const driveRes = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id"
    });

    // Save metadata
    const photos = JSON.parse(fs.readFileSync(METADATA_FILE));
    const newEntry = {
      id: driveRes.data.id,
      filename: req.file.originalname,
      caption,
      uploadedAt: new Date().toISOString()
    };
    photos.push(newEntry);
    fs.writeFileSync(METADATA_FILE, JSON.stringify(photos, null, 2));

    // cleanup local temp
    fs.unlinkSync(req.file.path);

    res.json({ success: true, ...newEntry });
  } catch (e) {
    console.error("Upload error:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// List photos
app.get("/api/list", verifyJWTMiddleware, (req, res) => {
  try {
    const photos = JSON.parse(fs.readFileSync(METADATA_FILE));
    res.json(photos);
  } catch (e) {
    res.status(500).json({ error: "List failed" });
  }
});

// Stream a file securely from Google Drive
app.get("/api/file/:id", verifyJWTMiddleware, async (req, res) => {
  try {
    const fileId = req.params.id;
    const driveRes = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );
    driveRes.data
      .on("end", () => console.log("File streamed:", fileId))
      .on("error", (err) => {
        console.error("Stream error:", err);
        res.status(500).end();
      })
      .pipe(res);
  } catch (e) {
    console.error("File stream error:", e);
    res.status(500).json({ error: "File fetch failed" });
  }
});

// ===== Start server =====
app.use(cors());
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
