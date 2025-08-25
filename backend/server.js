// backend/server.js
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload"; // agar use kar rahe ho
// ...baaki imports

const app = express();

const allowed = [
  "https://shreshthapushkar.com",
  "https://www.shreshthapushkar.com",
  "https://dostvardhan.github.io",       // agar GitHub Pages se serve ho raha ho to
  "http://localhost:5500",               // local testing (optional)
  "http://127.0.0.1:5500"                // local testing (optional)
];

app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  },
  credentials: false
}));

app.options("*", cors()); // preflight

app.use(fileUpload()); // ya jo bhi multipart parser use ho
app.use(express.json());

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// UPLOAD route (already hoga)
app.post("/upload", async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ ok: false, error: "No file" });
    }
    const theFile = req.files.file;
    // ... yaha Google Drive me upload ka aapka existing logic
    // return res.json({ ok: true, file: { id, name, webViewLink, webContentLink }});
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// app.listen(...) // Render pe already configured
export default app;
