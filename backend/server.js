// backend/server.js
// ESM imports (warning hataane ke liye optional: backend/package.json me { "type": "module" } add kar sakte ho)
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import fs from "fs";
import { google } from "googleapis";

/* ========= Google OAuth2 / Drive Config (Render env vars) ========= */
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,        // optional: jis Drive folder me files daalni hain
  MAKE_PUBLIC = "true",   // "true" => upload ke baad public permission (anyone with link)
} = process.env;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth2Client });

/* ============================ App Init ============================ */
const app = express();

/* ----------------------------- CORS ------------------------------ */
const allowed = [
  "https://shreshthapushkar.com",
  "https://www.shreshthapushkar.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);
app.options("*", cors());

/* --------------------- Body / File Parsers ----------------------- */
// IMPORTANT: useTempFiles = true => tempFilePath milta hai (Drive stream ke liye)
app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp",
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    abortOnLimit: true,
    parseNested: true,
  })
);
app.use(express.json());

/* ============================ Helpers ============================ */
async function makeFilePublic(fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (e) {
    // already public / quota / etc — ignore
    console.warn("makeFilePublic warn:", e?.message || e);
  }
}

async function getLinks(fileId) {
  const { data } = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size,webViewLink,webContentLink",
  });
  const webContentLink =
    data.webContentLink || `https://drive.google.com/uc?id=${fileId}&export=download`;
  return { ...data, webContentLink };
}

/* ============================= Routes ============================ */

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Upload a file to Drive
app.post("/upload", async (req, res) => {
  const cleanup = (p) => {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  };

  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ ok: false, error: "No file" });
    }

    const theFile = req.files.file;
    const tempPath = theFile.tempFilePath; // provided by express-fileupload

    if (!tempPath || !fs.existsSync(tempPath)) {
      return res
        .status(400)
        .json({ ok: false, error: "Temp file not found. Try again." });
    }

    const requestBody = {
      name: theFile.name,
      mimeType: theFile.mimetype || "application/octet-stream",
      ...(DRIVE_FOLDER_ID ? { parents: [DRIVE_FOLDER_ID] } : {}),
    };

    const media = {
      mimeType: theFile.mimetype || "application/octet-stream",
      body: fs.createReadStream(tempPath), // stream => fixes .pipe error
    };

    const createResp = await drive.files.create({
      requestBody,
      media,
      fields: "id,name,mimeType,size",
    });

    const fileId = createResp.data.id;

    if (String(MAKE_PUBLIC).toLowerCase() === "true") {
      await makeFilePublic(fileId);
    }

    const meta = await getLinks(fileId);

    cleanup(tempPath);

    return res.json({
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
    try {
      if (req?.files?.file?.tempFilePath) cleanup(req.files.file.tempFilePath);
    } catch {}
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "Upload failed" });
  }
});

// List latest files (for Gallery)
app.get("/list", async (req, res) => {
  try {
    const pageSize = Number(req.query.limit || 100);
    const q = DRIVE_FOLDER_ID
      ? `'${DRIVE_FOLDER_ID}' in parents and trashed = false`
      : "trashed = false";

    const { data } = await drive.files.list({
      q,
      orderBy: "createdTime desc",
      pageSize,
      fields:
        "files(id,name,mimeType,size,createdTime,thumbnailLink,webViewLink,webContentLink)",
    });

    const files = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      createdTime: f.createdTime,
      webViewLink: f.webViewLink,
      webContentLink:
        f.webContentLink || `https://drive.google.com/uc?id=${f.id}&export=download`,
      thumb: f.thumbnailLink || `https://drive.google.com/thumbnail?id=${f.id}`,
      viewSrc: `https://drive.google.com/uc?id=${f.id}&export=view`,
    }));

    return res.json({ ok: true, files });
  } catch (e) {
    console.error("LIST ERROR:", e?.response?.data || e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "List failed" });
  }
});

/* ============================ Start ============================== */
const PORT = process.env.PORT || 3000; // Render sets PORT
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
