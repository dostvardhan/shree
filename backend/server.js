// server.js — Shree Drive Uploader (robust stream + fixed diag)
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
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    abortOnLimit: true,
    useTempFiles: true,
    tempFileDir: "/tmp",
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
  return {
    code: e?.response?.status || e?.code || 500,
    statusText: e?.response?.statusText,
    message:
      e?.response?.data?.error?.message ||
      e?.message ||
      "Unknown Error.",
  };
}
function ensureStreamOpen(stream) {
  return new Promise((resolve, reject) => {
    let settled = false;
    stream.once("open", () => { if (!settled) { settled = true; resolve(); } });
    stream.once("readable", () => { if (!settled) { settled = true; resolve(); } });
    stream.once("error", (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

// ---------- Routes ----------
app.get("/health", (_req, res) => res.json({ ok: true }));

// Fixed diag: only fields that Drive returns reliably
app.get("/diag", async (_req, res) => {
  try {
    const d = drive();
    // emailAddress can be blocked in some orgs; request minimal fields
    const about = await d.about.get({ fields: "user(displayName,permissionId),storageQuota" });
    res.json({ ok: true, user: about.data.user, storageQuota: about.data.storageQuota });
  } catch (e) {
    res.status(500).json({ ok: false, error: safeErr(e) });
  }
});

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

// upload (private by default) with folder-first + root fallback
app.post("/upload", async (req, res) => {
  try {
    if (UPLOAD_API_KEY && req.headers["x-api-key"] !== UPLOAD_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!REFRESH_TOKEN) return res.status(400).json({ error: "Missing REFRESH_TOKEN" });
    if (!req.files || !req.files.file) return res.status(400).json({ error: "No file uploaded" });

    // Preflight Drive
    try { await drive().about.get({ fields: "user" }); }
    catch (e) { return res.status(500).json({ error: "Drive preflight failed", details: safeErr(e) }); }

    const f = req.files.file;
    const allowed = ["image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif"];
    if (!allowed.includes(f.mimetype)) {
      return res.status(400).json({ error: "Only image uploads are allowed" });
    }
    if (!f.tempFilePath) {
      return res.status(500).json({ error: "Temp file path missing" });
    }

    // Ensure the stream is open before sending to Google
    const stream = fs.createReadStream(f.tempFilePath);
    try { await ensureStreamOpen(stream); }
    catch (err) {
      return res.status(500).json({ error: "Temp file unreadable", details: String(err) });
    }

    const name = timestampedName(f.name);
    const parents = DRIVE_FOLDER_ID && DRIVE_FOLDER_ID !== "root" ? [DRIVE_FOLDER_ID] : undefined;

    const createOnce = async (useParents) => {
      const requestBody = useParents
        ? { name, parents, mimeType: f.mimetype }
        : { name, mimeType: f.mimetype };

      // create a fresh stream each attempt
      const bodyStream = fs.createReadStream(f.tempFilePath);
      await ensureStreamOpen(bodyStream);

      const { data: file } = await drive().files.create({
        requestBody,
        media: { mimeType: f.mimetype, body: bodyStream },
        fields: "id,name,createdTime,webViewLink,webContentLink",
        supportsAllDrives: true,
      });

      if (MAKE_PUBLIC === "true") {
        await drive().permissions.create({
          fileId: file.id,
          requestBody: { role: "reader", type: "anyone" },
          supportsAllDrives: true,
        });
      }
      return file;
    };

    try {
      const file = await createOnce(Boolean(parents));
      return res.json({ ok: true, where: parents ? "folder" : "root", file });
    } catch (e1) {
      try {
        const file = await createOnce(false);
        return res.status(207).json({
          ok: true,
          where: "root-fallback",
          note: "Uploaded to My Drive root. Check DRIVE_FOLDER_ID or permissions.",
          firstError: safeErr(e1),
          file,
        });
      } catch (e2) {
        return res.status(500).json({
          error: "Upload failed (folder & root both failed)",
          details: { first: safeErr(e1), second: safeErr(e2) },
        });
      }
    }
  } catch (e) {
    return res.status(500).json({ error: "Upload failed", details: safeErr(e) });
  }
});

// list photos (newest first)
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
    return res.status(500).json({ error: "List failed", details: safeErr(e) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
