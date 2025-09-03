import express from "express";
import multer from "multer";
import cors from "cors";
import { google } from "googleapis";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ CORS allow only your Netlify site
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    credentials: true,
  })
);

app.use(express.json());

// 🔑 Google OAuth2 setup
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

// ✅ Upload route
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const fileMetadata = {
      name: req.file.originalname,
      parents: [FOLDER_ID],
    };

    const media = {
      mimeType: req.file.mimetype,
      body: Buffer.isBuffer(req.file.buffer)
        ? BufferToStream(req.file.buffer)
        : req.file.buffer,
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id, name",
    });

    // Make file public if enabled
    if (process.env.MAKE_PUBLIC === "true") {
      await drive.permissions.create({
        fileId: file.data.id,
        requestBody: { role: "reader", type: "anyone" },
      });
    }

    const fileUrl =
      process.env.MAKE_PUBLIC === "true"
        ? `https://drive.google.com/uc?id=${file.data.id}`
        : `https://drive.google.com/file/d/${file.data.id}/view`;

    res.json({ id: file.data.id, name: file.data.name, url: fileUrl });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ✅ List files route
app.get("/list", async (req, res) => {
  try {
    const response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: "files(id, name, mimeType)",
    });

    const files = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      url:
        process.env.MAKE_PUBLIC === "true"
          ? `https://drive.google.com/uc?id=${file.id}`
          : `https://drive.google.com/file/d/${file.id}/view`,
    }));

    res.json({ files });
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ error: "Failed to fetch list" });
  }
});

// ✅ Small diag route (check if working)
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

function BufferToStream(buffer) {
  const { Readable } = require("stream");
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
