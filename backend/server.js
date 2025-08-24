// server.js — Shree Drive Uploader (diagnostic-safe, private by default)
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

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
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    abortOnLimit: true,
    useTempFiles: true,
    tempFileDir: "/tmp", // Render's tmp
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
const pad = (n) => String(n).padStart(2, "0");
function timestampedName(original) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${stamp}_${original}`.replace(/[^\w.\-@()+\s]/g, "_");
}
function safeErr(e) {
  // Extract useful message WITHOUT leaking secrets
  const g = e?.response?.data?.error?.message || e?.message || String(e);
  const code = e?.response?.status || e?.code || undefined;
  return { code, message: g };
}
function fileStat(p) {
  try {
    const st = fs.statSync(p);
    return { exists: true, size: st.size };
  } catch {
    return { exists: false, size: 0 };
  }
}

// ---------- Routes ----------
app.get("/health", (_req, res) => res.json({ ok: true }));

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

// upload (private by default) with diagnostics & root fallback
app.post("/upload", async (req, res) => {
  try {
    if (UPLOAD_API_KEY && req.headers["x-api-key"] !== UPLOAD_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!REFRESH_TOKEN) return res.status(400).json({ error: "Missing REFRESH_TOKEN" });
    if (!req.files || !req.files.file) return res.status(400).json({ error: "No file uploaded" });

    const f = req.files.file;
    const allowed = ["image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif"];
    if (!allowed.includes(f.mimetype)) {
      return res.status(400).json({ error: "Only image uploads are allowed" });
    }

    // temp file must exist
    const tmp = f.tempFilePath;
    const stat = fileStat(tmp);
    if (!stat.exists || stat.size === 0) {
      return res.status(500).json({
        error: "Temp file not found",
        details: { tempFilePath: tmp, size: stat.size }
      });
    }

    const name = timestampedName(f.name);
    const parents = DRIVE_FOLDER_ID && DRIVE_FOLDER_ID !== "root" ? [DRIVE_FOLDER_ID] : undefined;
    const requestBody = { name, parents };

    // Try upload to target folder (if provided)
    try {
      const { data: file } = await drive().files.create({
        requestBody,
        media: { mimeType: f.mimetype, body: fs.createReadStream(tmp) },
        fields: "id, name, createdTime, webViewLink, webContentLink, thumbnailLink",
        supportsAllDrives: true,
      });

      // public toggle
      if (MAKE_PUBLIC === "true") {
        await drive().permissions.create({
          fileId: file.id,
          requestBody: { role: "reader", type: "anyone" },
          supportsAllDrives: true,
        });
      }
      return res.json({ ok: true, file });
    } catch (e) {
      const err = safeErr(e);

      // If folder issue (403/404), fallback to root to help diagnose
      if (parents && (err.code === 403 || err.code === 404)) {
        try {
          const { data: file } = await drive().files.create({
            requestBody: { name }, // no parents → root
            media: { mimeType: f.mimetype, body: fs.createReadStream(tmp) },
            fields: "id, name, createdTime, webViewLink, webContentLink, thumbnailLink",
            supportsAllDrives: true,
          });
          return res.status(207).json({
            ok: true,
            note: "Uploaded to My Drive root (folder not accessible). Check DRIVE_FOLDER_ID permissions.",
            file,
          });
        } catch (e2) {
          const err2 = safeErr(e2);
          return res.status(500).json({
            error: "Upload failed (root fallback failed too)",
            details: { first: err, second: err2 }
          });
        }
      }

      return res.status(500).json({ error: "Upload failed", details: err });
    }
  } catch (e) {
    const err = safeErr(e);
    return res.status(500).json({ error: "Upload failed", details: err });
  }
});

// list photos
app.get("/photos", async (_req, res) => {
  try {
    if (!REFRESH_TOKEN) return res.status(400).json({ error: "Missing REFRESH_TOKEN" });

    const q = DRIVE_FOLDER_ID && DRIVE_FOLDER_ID !== "root"
      ? `'${DRIVE_FOLDER_ID}' in parents and trashed=false`
      : `'root' in parents and trashed=false`;

    const { data } = await drive().files.list({
      q,
      fields: "files(id,name,createdTime,webViewLink,webContentLink,thumbnailLink,appProperties),nextPageToken",
      orderBy: "createdTime desc",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return res.json({ ok: true, items: data.files || [] });
  } catch (e) {
    const err = safeErr(e);
    return res.status(500).json({ error: "List failed", details: err });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
