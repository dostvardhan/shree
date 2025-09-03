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
// CORS setup
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
const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

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
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
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

// Upload file
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
      media: media,
      fields: "id, name",
    });

    // No public permission (MAKE_PUBLIC=false)
    let fileUrl = `https://drive.google.com/file/d/${file.data.id}/view`;

    res.json({ id: file.data.id, name: file.data.name, url: fileUrl });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// List files
app.get("/list", requireAuth, async (req, res) => {
  try {
    const response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: "files(id, name, mimeType)",
    });

    const files = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      url: `https://drive.google.com/file/d/${file.id}/view`,
    }));

    res.json({ files });
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ error: "Failed to fetch list" });
  }
});

// Diag route
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

// -------------------------
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
