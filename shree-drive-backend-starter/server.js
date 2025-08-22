import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { google } from "googleapis";
import fs from "fs";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

// ====== CONFIG ======
const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON_PATH || "./service-account.json";

// CORS
app.use(cors({ origin: ALLOWED_ORIGIN }));

// Health check
app.get("/", (_req, res) => res.send("Shree Drive Uploader OK"));

// Google auth helper
function getDrive() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_JSON,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

// Upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const drive = getDrive();
  const filePath = req.file.path;
  const fileName = req.file.originalname;

  try {
    const fileMetadata = { name: fileName, parents: [DRIVE_FOLDER_ID] };
    const media = { mimeType: req.file.mimetype, body: fs.createReadStream(filePath) };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id, name, webViewLink, webContentLink",
    });

    // Optional: make public via link
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: "reader", type: "anyone" },
    });

    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      success: true,
      id: response.data.id,
      name: response.data.name,
      viewLink: response.data.webViewLink,
      downloadLink: response.data.webContentLink,
    });
  } catch (err) {
    try { fs.existsSync(filePath) && fs.unlinkSync(filePath); } catch {}
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

// List files
app.get("/files", async (_req, res) => {
  try {
    const drive = getDrive();
    const q = `'${DRIVE_FOLDER_ID}' in parents and trashed = false`;
    const { data } = await drive.files.list({
      q,
      fields: "files(id, name, webViewLink, webContentLink, createdTime)",
      orderBy: "createdTime desc",
      pageSize: 50,
    });
  } catch (err) {
    res.status(500).json({ error: "List failed", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
