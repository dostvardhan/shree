// =============================================
// backend/server.js — Google Drive Uploader API
// Fixes: "app is not defined", adds /auth/url, /oauth2callback, /diag, /upload
// =============================================

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const multer = require("multer");

const app = express();

// ----- Config & Middleware -----
const PORT = process.env.PORT || 3000;

// Allow single or multiple origins via ALLOWED_ORIGIN env (comma-separated). Defaults to "*".
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(",").map(s => s.trim())
  : "*";

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Multer for in-memory file handling
const upload = multer({ storage: multer.memoryStorage() });

// ----- OAuth Helpers -----
function getOAuth2Client() {
  const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env;
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error("Missing env: CLIENT_ID / CLIENT_SECRET / REDIRECT_URI");
  }
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function getDriveClient() {
  const { REFRESH_TOKEN } = process.env;
  if (!REFRESH_TOKEN) {
    throw new Error("REFRESH_TOKEN not set. First run /auth/url → consent → /oauth2callback.");
  }
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: oauth2 });
}

// ----- Routes -----

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Simple landing
app.get("/", (req, res) => {
  res.type("text").send("Shree Drive Uploader OK");
});

// 1) Generate Google consent URL (opens Google login)
app.get("/auth/url", (req, res) => {
  try {
    const oauth2 = getOAuth2Client();
    const scope = process.env.SCOPE || "https://www.googleapis.com/auth/drive.file";
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope,
    });
    return res.redirect(url); // or: res.json({ url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// 2) OAuth2 callback — exchanges code→tokens and shows REFRESH_TOKEN once
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing ?code param");

  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token || null;

    // SECURITY NOTE: Don't log tokens in production. We only render once for copy-paste.
    const html = `
      <html>
        <body style="font-family: system-ui; padding: 24px;">
          <h2>OAuth success ✅</h2>
          <p><b>Next:</b> Copy <code>REFRESH_TOKEN</code> below → paste into Render Environment → redeploy.</p>
          <pre style="white-space: pre-wrap; word-break: break-all; background:#f6f8fa; padding:12px; border-radius:8px;">
REFRESH_TOKEN=${refreshToken || "(not returned — ensure access_type=offline & prompt=consent; remove app access and try again)"}
          </pre>
          <p>Tip: If no refresh_token above, remove app access at 
            <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a> 
            and try again.</p>
        </body>
      </html>`;
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send("Token exchange failed: " + e.message);
  }
});

// 3) Diagnostics — who am I? storage?
app.get("/diag", async (req, res) => {
  try {
    const drive = getDriveClient();
    const about = await drive.about.get({ fields: "user,storageQuota" });
    return res.json({ ok: true, user: about.data.user, storage: about.data.storageQuota });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// 4) Upload — multipart (field name: "file")
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    const drive = getDriveClient();

    const parents = process.env.DRIVE_FOLDER_ID
      ? [process.env.DRIVE_FOLDER_ID]
      : undefined;

    const fileMetadata = {
      name: req.file.originalname,
      ...(parents ? { parents } : {}),
    };

    const media = {
      mimeType: req.file.mimetype || "application/octet-stream",
      body: bufferToStream(req.file.buffer),
    };

    const createResp = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id,name,mimeType,size,webViewLink,webContentLink",
    });

    const file = createResp.data;

    // Optional public link
    if (String(process.env.MAKE_PUBLIC || "").toLowerCase() === "true") {
      try {
        await drive.permissions.create({
          fileId: file.id,
          requestBody: { role: "reader", type: "anyone" },
        });
        const refreshed = await drive.files.get({
          fileId: file.id,
          fields: "webViewLink,webContentLink",
        });
        file.webViewLink = refreshed.data.webViewLink;
        file.webContentLink = refreshed.data.webContentLink;
      } catch {
        // ignore permission errors; still return file
      }
    }

    return res.json({ ok: true, file });
  } catch (e) {
    return res.status(500).json({ error: "Upload failed", details: e.message });
  }
});

// ----- Helpers -----
function bufferToStream(buf) {
  const { Readable } = require("stream");
  const stream = new Readable();
  stream.push(buf);
  stream.push(null);
  return stream;
}

// ----- Start server -----
app.listen(PORT, () => {
  console.log(`Shree Drive Uploader listening on :${PORT}`);
});
