import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { google } from "googleapis";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// === Auth0 JWT verification ===
const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function (err, key) {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function checkJwt(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing Authorization header" });

  const token = authHeader.split(" ")[1];
  jwt.verify(
    token,
    getKey,
    {
      audience: process.env.AUTH0_AUDIENCE,
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      algorithms: ["RS256"],
    },
    (err, decoded) => {
      if (err) return res.status(401).json({ error: "Invalid token", details: err.message });
      req.user = decoded;
      next();
    }
  );
}

// === Google Drive setup ===
const oauth2Client = new google.auth.OAuth2();
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth2Client });

// === Multer upload ===
const upload = multer({ dest: "backend/uploads/" });

// === Routes ===

// Root route (new)
app.get("/", (req, res) => {
  res.send("✅ Shree backend is live. Use /upload, /list, /file/:id");
});

// Upload to Google Drive
app.post("/upload", checkJwt, upload.single("file"), async (req, res) => {
  try {
    const fileMetadata = {
      name: req.file.originalname,
      parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined,
    };
    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id, name, mimeType",
    });

    fs.unlinkSync(req.file.path); // remove temp file

    res.json({ id: file.data.id, name: file.data.name });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// List files
app.get("/list", checkJwt, async (req, res) => {
  try {
    const response = await drive.files.list({
      q: process.env.DRIVE_FOLDER_ID ? `'${process.env.DRIVE_FOLDER_ID}' in parents` : undefined,
      fields: "files(id, name, mimeType, description)",
    });
    res.json({ files: response.data.files });
  } catch (err) {
    console.error("List error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve file by ID
app.get("/file/:id", checkJwt, async (req, res) => {
  try {
    const fileId = req.params.id;
    const driveRes = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    res.setHeader("Content-Type", "application/octet-stream");
    driveRes.data.pipe(res);
  } catch (err) {
    console.error("File fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
