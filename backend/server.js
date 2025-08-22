import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(express.json());

// ---- CORS (lock to your site) ----
const allowed = process.env.ALLOWED_ORIGIN?.split(",").map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || !allowed || allowed.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked: " + origin));
  }
}));

// ---- Temp upload dir ----
const TMP_DIR = process.env.TMP_DIR || "uploads";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR });

// ---- Google OAuth client (NO service account) ----
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI || "http://localhost:3000/oauth2callback"
);
if (process.env.REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
}
const drive = google.drive({ version: "v3", auth: oauth2Client });

// ---- helpers ----
const tz = process.env.TZ || "Asia/Kolkata";
function todayStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date()); // YYYY-MM-DD
}

// ---- health ----
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- OAuth: get consent URL (run once to fetch refresh token) ----
app.get("/auth/url", (_req, res) => {
  try {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/drive.file"] // app-created files
    });
    res.send(url);
  } catch (e) {
    res.status(500).send("Failed to generate auth URL: " + e.message);
  }
});

// ---- OAuth callback: copy refresh_token from logs then add to env ----
app.get("/oauth2callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    console.log("TOKENS:", tokens); // copy tokens.refresh_token to env
    res.send("Auth complete ✅ Check logs for REFRESH_TOKEN. Set it in env and redeploy.");
  } catch (e) {
    console.error(e);
    res.status(500).send("OAuth failed: " + e.message);
  }
});

// ---- self-test: verify Drive access by creating a tiny text file ----
app.get("/selftest", async (_req, res) => {
  try {
    if (!process.env.REFRESH_TOKEN) {
      return res.status(500).json({ ok: false, where: "env", msg: "Missing REFRESH_TOKEN" });
    }
    const r = await drive.files.create({
      requestBody: {
        name: `ping-${Date.now()}.txt`,
        parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined
      },
      media: { mimeType: "text/plain", body: Buffer.from("ping " + new Date().toISOString()) },
      fields: "id,name,webViewLink"
    });
    res.json({ ok: true, file: r.data });
  } catch (e) {
    res.status(500).json({ ok: false, where: "drive", msg: e.message });
  }
});

// ---- generic upload (field name: file) ----
app.post("/upload", upload.single("file"), async (req, res) => {
  let temp;
  try {
    if (!process.env.REFRESH_TOKEN) return res.status(500).json({ error: "Missing REFRESH_TOKEN" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    temp = req.file.path;
    const params = {
      requestBody: {
        name: req.file.originalname,
        parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined
      },
      media: { mimeType: req.file.mimetype, body: fs.createReadStream(temp) },
      fields: "id,name,webViewLink,webContentLink"
    };
    if (process.env.SUPPORTS_ALL_DRIVES === "true") params.supportsAllDrives = true;

    const r = await drive.files.create(params);

    if (process.env.MAKE_PUBLIC === "true") {
      await drive.permissions.create({
        fileId: r.data.id, requestBody: { role: "reader", type: "anyone" }
      });
    }

    res.json({ ok: true, file: r.data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed", details: e.message });
  } finally {
    if (temp && fs.existsSync(temp)) { try { fs.unlinkSync(temp); } catch {} }
  }
});

// ---- daily upload (one photo per day + note) (fields: photo, note) ----
app.post("/upload-daily", upload.single("photo"), async (req, res) => {
  let temp;
  try {
    if (!process.env.REFRESH_TOKEN) return res.status(500).json({ error: "Missing REFRESH_TOKEN" });
    if (!req.file) return res.status(400).json({ error: "No photo" });

    const note = (req.body.note || "").toString().trim();
    const today = todayStr();
    const ext = (req.file.originalname.match(/\.[a-zA-Z0-9]+$/) || [".jpg"])[0];
    const fileName = `${today}${ext}`;

    // exact-name check in target location
    const locationQ = process.env.DRIVE_FOLDER_ID ? `'${process.env.DRIVE_FOLDER_ID}' in parents` : "'me' in owners";
    const existing = await drive.files.list({
      q: `name='${fileName}' and ${locationQ}`,
      pageSize: 1,
      fields: "files(id,name)"
    });
    if ((existing.data.files || []).length > 0) {
      return res.status(409).json({ error: "Already uploaded today" });
    }

    temp = req.file.path;
    const create = await drive.files.create({
      requestBody: {
        name: fileName,
        description: note,
        parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined
      },
      media: { mimeType: req.file.mimetype, body: fs.createReadStream(temp) },
      fields: "id,name,webViewLink,createdTime"
    });

    if (process.env.MAKE_PUBLIC === "true") {
      await drive.permissions.create({
        fileId: create.data.id, requestBody: { role: "reader", type: "anyone" }
      });
    }

    res.json({ ok: true, date: today, note, file: create.data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed", details: e.message });
  } finally {
    if (temp && fs.existsSync(temp)) { try { fs.unlinkSync(temp); } catch {} }
  }
});

// ---- gallery list (last 50) ----
app.get("/gallery", async (_req, res) => {
  try {
    const locationQ = process.env.DRIVE_FOLDER_ID ? `'${process.env.DRIVE_FOLDER_ID}' in parents` : "'me' in owners";
    const r = await drive.files.list({
      q: locationQ,
      orderBy: "createdTime desc",
      fields: "files(id,name,description,webViewLink,createdTime)",
      pageSize: 50
    });
    res.json({ ok: true, files: r.data.files || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list gallery", details: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Uploader listening on :${PORT}`));
