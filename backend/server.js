// backend/server.js
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import fs from "fs";
import { google } from "googleapis";

// ==== Google OAuth Config (Render env vars) ====
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  REFRESH_TOKEN,
  DRIVE_FOLDER_ID,       // optional
  MAKE_PUBLIC = "true",  // "true" => anyone with link can view
} = process.env;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oauth2Client });

const app = express();

// ==== CORS (allow your site) ====
const allowed = [
  "https://shreshthapushkar.com",
  "https://www.shreshthapushkar.com",
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

// ==== Body & File Parser ====
// IMPORTANT: useTempFiles=true => provides tempFilePath we can stream
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

// ==== Helpers ====
async function makeFilePublic(fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (e) {
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

// ==== Routes ====
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/upload", async (req, res) => {
  // Clean-up helper (deletes temp file if exists)
  const cleanup = (p) => {
    if (p && fs.existsSync(p)) {
      fs.unlink(p, () => {});
    }
  };

  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ ok: false, error: "No file" });
    }

    const theFile = req.files.file;
    const tempPath = theFile.tempFilePath; // comes from useTempFiles:true

    if (!tempPath || !fs.existsSync(tempPath)) {
      return res
        .status(400)
        .json({ ok: false, error: "Temp file not found. Try again." });
    }

    // Create metadata + stream
    const requestBody = {
      name: theFile.name,
      mimeType: theFile.mimetype || "application/octet-stream",
      ...(DRIVE_FOLDER_ID ? { parents: [DRIVE_FOLDER_ID] } : {}),
    };

    const media = {
      mimeType: theFile.mimetype || "application/octet-stream",
      body: fs.createReadStream(tempPath), // << stream fixes .pipe error
    };

    // Upload to Drive
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

    // cleanup temp
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
    // try cleanup if something went wrong
    try {
      if (req?.files?.file?.tempFilePath) fs.unlink(req.files.file.tempFilePath, () => {});
    } catch {}
    return res.status(500).json({ ok: false, error: e?.message || "Upload failed" });
  }
});

// ==== Start server ====
const PORT = process.env.PORT || 3000; // Render passes PORT
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
