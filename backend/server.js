import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import cors from "cors";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { Readable } from "stream";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// -------------------------
// CORS
// -------------------------
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

// -------------------------
// Auth0 JWT verification
// -------------------------
const jwks = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function requireAuth(req, res, next) {
  // Bearer token only (safer than query)
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authHeader.split(" ")[1];

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ["RS256"],
      audience: process.env.AUTH0_AUDIENCE,
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
    },
    (err, decoded) => {
      if (err) return res.status(401).json({ error: "Invalid token" });
      req.user = decoded;
      next();
    }
  );
}

// -------------------------
// Google Drive setup
// -------------------------
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,       // Google OAuth Client ID (.apps.googleusercontent.com)
  process.env.CLIENT_SECRET,   // Google OAuth Client Secret
  process.env.REDIRECT_URI     // https://developers.google.com/oauthplayground
);
oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});
const drive = google.drive({ version: "v3", auth: oauth2Client });
const FOLDER_ID = process.env.DRIVE_FOLDER_ID;

// -------------------------
// Helper: Buffer → Stream
// -------------------------
function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

// -------------------------
// Routes
// -------------------------

// Health/diag
app.get("/diag", async (req, res) => {
  try {
    const about = await drive.about.get({ fields: "user, storageQuota" });
    res.json({
      ok: true,
      user: about.data.user,
      folder: FOLDER_ID,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Upload (private)
app.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const fileMetadata = {
      name: req.file.originalname,
      parents: [FOLDER_ID],
    };

    const media = {
      mimeType: req.file.mimetype,
      body: bufferToStream(req.file.buffer),
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id, name",
    });

    // We keep files private (MAKE_PUBLIC=false). No permissions added.
    res.json({
      id: file.data.id,
      name: file.data.name,
    });
  } catch (err) {
    console.error("Upload error:", err?.response?.data || err.message);
    res.status(500).json({ error: "Upload failed" });
  }
});

// List (ids + mime)
app.get("/list", requireAuth, async (req, res) => {
  try {
    const response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: "files(id, name, mimeType)",
      orderBy: "createdTime desc",
    });

    const files = (response.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
    }));

    res.json({ files });
  } catch (err) {
    console.error("List error:", err?.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch list" });
  }
});

// Secure image/file stream for <img> (keeps Drive private)
app.get("/file/:id", requireAuth, async (req, res) => {
  try {
    const fileId = req.params.id;

    // Get mime for proper headers
    const meta = await drive.files.get({
      fileId,
      fields: "id, name, mimeType",
    });

    res.setHeader(
      "Content-Type",
      meta.data.mimeType || "application/octet-stream"
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${meta.data.name.replace(/"/g, '\\"')}"`
    );

    const driveRes = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    driveRes.data
      .on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) res.status(500).end("Stream error");
      })
      .pipe(res);
  } catch (err) {
    console.error("File stream error:", err?.response?.data || err.message);
    if (!res.headersSent) res.status(404).json({ error: "File not found" });
  }
});

// -------------------------
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
