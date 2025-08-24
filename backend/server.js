// server.js — Shree Drive Uploader (safe & private)
// Dependencies: express, cors, express-fileupload, googleapis

const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const { google } = require("googleapis");
const fs = require("fs");

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,
  MAKE_PUBLIC,
  ALLOWED_ORIGIN,
  UPLOAD_API_KEY, // optional
} = process.env;

const app = express();

// ---------- Middleware ----------
app.use(express.json());
app.use(
  cors({
    origin: ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(",") : "*",
  })
);
app.use(
  fileUpload({
    limits: { fileSize: 25 * 1024 * 1024 }, // max 25MB
    abortOnLimit: true,
    useTempFiles: true,          // use temp files instead of buffer
    tempFileDir: "/tmp",         // Render supports /tmp for temporary files
  })
);

// ---------- Helpers ----------
function oauthClient() {
  const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  if (REFRESH_TOKEN) o.setCredentials({ refresh_token: REFRESH_TOKEN });
  return o;
}
function drive() {
  return google.drive({ version: "v3", auth: oauthClient() });
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function timestampedName(original) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${stamp}_${original}`.replace(/[^\w.\-@()+\s]/g, "_");
}

// ---------- Routes ----------

// health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// safe oauth2callback (no token leak)
app.get("/oauth2callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing code");
    const o = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    await o.getToken(code); // no logging
    return res.status(200).send("Auth complete ✅");
  } catch {
    return res.status(500).send("Auth failed");
  }
});

// upload (private by default)
app.post("/upload", async (req, res) => {
  try {
    // optional API key protection
    if (UPLOAD_API_KEY && req.headers["x-api-key"] !== UPLOAD_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!REFRESH_TOKEN)
      return res.status(400).json({ error: "Missing REFRESH_TOKEN" });
    if (!req.files || !req.files.file)
      return res.status(400).json({ error: "No file uploaded" });

    const f = req.files.file;

    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
      "image/heif",
    ];
    if (!allowed.includes(f.mimetype)) {
      return res
        .status(400)
        .json({ error: "Only image uploads are allowed" });
    }

    const name = timestampedName(f.name);
    const parents =
      DRIVE_FOLDER_ID && DRIVE_FOLDER_ID !== "root" ? [DRIVE_FOLDER_ID] : null;

    const requestBody = { name, parents: parents || undefined };

    const { data: file } = await drive().files.create({
      requestBody,
      // ✅ use temp file stream (most reliable)
      media: { mimeType: f.mimetype, body: fs.createReadStream(f.tempFilePath) },
      fields:
        "id, name, createdTime, webViewLink, webContentLink, thumbnailLink",
      supportsAllDrives: true,
    });

    // public toggle (defaults to private)
    if (MAKE_PUBLIC === "true") {
      await drive().permissions.create({
        fileId: file.id,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
      // re-fetch links after permission change (optional)
      const { data: full } = await drive().files.get({
        fileId: file.id,
        fields: "id, webViewLink, webContentLink",
        supportsAllDrives: true,
      });
      file.webViewLink = full.webViewLink || file.webViewLink;
      file.webContentLink = full.webContentLink || file.webContentLink;
    }

    return res.json({ ok: true, file });
  } catch (e) {
    return res
      .status(500)
      .json({ error: "Upload failed", details: String(e.message || e) });
  }
});

// list photos (newest first)
app.get("/photos", async (_req, res) => {
  try {
    if (!REFRESH_TOKEN)
      return res.status(400).json({ error: "Missing REFRESH_TOKEN" });

    const q =
      DRIVE_FOLDER_ID && DRIVE_FOLDER_ID !== "root"
        ? `'${DRIVE_FOLDER_ID}' in parents and trashed=false`
        : `'root' in parents and trashed=false`;

    const { data } = await drive().files.list({
      q,
      fields:
        "files(id,name,createdTime,webViewLink,webContentLink,thumbnailLink,appProperties),nextPageToken",
      orderBy: "createdTime desc",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return res.json({ ok: true, items: data.files || [] });
  } catch (e) {
    return res
      .status(500)
      .json({ error: "List failed", details: String(e.message || e) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000; // Render assigns its own port
app.listen(PORT, () => console.log("Server running on", PORT));
