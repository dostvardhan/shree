// upload (private by default) with folder-first + root fallback
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

    // allow only images
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
      "image/heif",
    ];
    if (!allowed.includes(f.mimetype)) {
      return res.status(400).json({ error: "Only image uploads are allowed" });
    }

    // express-fileupload must be in tempFile mode
    if (!f.tempFilePath) {
      return res.status(500).json({ error: "Temp file path missing" });
    }

    // timestamped filename
    const name = timestampedName(f.name);

    // prefer folder if provided
    const parents =
      DRIVE_FOLDER_ID && DRIVE_FOLDER_ID !== "root" ? [DRIVE_FOLDER_ID] : undefined;

    // helper: one upload attempt
    const createOnce = async (useParents) => {
      const requestBody = useParents
        ? { name, parents, mimeType: f.mimetype }  // set mimeType in requestBody
        : { name, mimeType: f.mimetype };

      const { data: file } = await drive().files.create({
        requestBody,
        media: { mimeType: f.mimetype, body: fs.createReadStream(f.tempFilePath) },
        fields: "id, name, createdTime, webViewLink, webContentLink, thumbnailLink",
        supportsAllDrives: true,
      });

      // public toggle (defaults to private)
      if (MAKE_PUBLIC === "true") {
        await drive().permissions.create({
          fileId: file.id,
          requestBody: { role: "reader", type: "anyone" },
          supportsAllDrives: true,
        });
      }

      return file;
    };

    // 1) Try folder (if parents set)
    try {
      const file = await createOnce(Boolean(parents));
      return res.json({ ok: true, where: parents ? "folder" : "root", file });
    } catch (e1) {
      // 2) Fallback to root to unblock
      try {
        const file = await createOnce(false);
        return res.status(207).json({
          ok: true,
          where: "root-fallback",
          note: "Uploaded to My Drive root. Check DRIVE_FOLDER_ID or permissions.",
          firstError: e1?.message || "folder upload failed",
          file,
        });
      } catch (e2) {
        return res.status(500).json({
          error: "Upload failed (folder & root both failed)",
          details: { first: e1?.message, second: e2?.message },
        });
      }
    }
  } catch (e) {
    return res
      .status(500)
      .json({ error: "Upload failed", details: e?.message || String(e) });
  }
});
