// backend/server.js
// ESM imports (make sure package.json has "type":"module" at root OR backend/package.json has it)
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import { google } from "googleapis";

// ---------- Config (env vars required on Render) ----------
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,       // optional
  MAKE_PUBLIC = "true",  // "true" to make files public
} = process.env;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !REFRESH_TOKEN) {
  console.warn(
    "⚠️ Missing Google OAuth env vars (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, REFRESH_TOKEN)"
  );
}

// Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth2Client });

// ---------- App ----------
const app = express();

// CORS: allow your site(s)
const allowed = [
  "https://shreshthapushkar.com",
  "https://www.shreshthapushkar.com",
  "https://dostvardhan.github.io", // if you ever serve from GitHub Pages
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);
app.options("*", cors());

// Body & file parser
app.use(
  fileUpload({
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    useTempFiles: false,
    abortOnLimit: true,
  })
);
app.use(express.json());

// ---------- Helpers ----------
async function makeFilePublic(fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (e) {
    // If already public or permission error, log and continue
    console.warn("makeFilePublic warn:", e?.message || e);
  }
}

async function getLinks(fileId) {
  const { data } = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, size, webViewLink, webContentLink",
  });
  // webContentLink sometimes empty; build a fallback download URL:
  const webContentLink =
    data.webContentLink ||
    `https://drive.google.com/uc?id=${fileId}&export=download`;
  return { ...data, webContentLink };
}

// ---------- Routes ----------

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// upload
app.post("/upload", async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ ok: false, error: "No file" });
    }
    const theFile = req.files.file;

    // Create file in Drive
    const requestBody = {
      name: theFile.name,
      mimeType: theFile.mimetype || "application/octet-stream",
      ...(DRIVE_FOLDER_ID ? { parents: [DRIVE_FOLDER_ID] } : {}),
    };

    const media = {
      mimeType: theFile.mimetype || "application/octet-stream",
      body: Buffer.isBuffer(theFile.data)
        ? Buffer.from(theFile.data)
        : theFile.data,
    };

    const createResp = await drive.files.create({
      requestBody,
      media,
      fields: "id,name,mimeType,size",
    });

    const fileId = createResp.data.id;

    // Make public if configured
    if (String(MAKE_PUBLIC).toLowerCase() === "true") {
      await makeFilePublic(fileId);
    }

    // Fetch view + download links
    const meta = await getLinks(fileId);

    res.json({
      ok: true,
      file: {
        id: meta.id,
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        webViewLink: meta.webViewLink,
        webContentLink: meta.webContentLink,
      },
    });
  } catch (e) {
    console.error("UPLOAD ERROR:", e?.response?.data || e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Upload failed" });
  }
});

// ---------- Start server (required on Render) ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
