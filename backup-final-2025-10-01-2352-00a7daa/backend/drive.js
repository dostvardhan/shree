// backend/drive.js
import { google } from "googleapis";
import stream from "stream";

function createDriveClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing Google OAuth env vars (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN)");
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  return google.drive({ version: "v3", auth: oauth2Client });
}

export async function uploadBufferToDrive(buffer, filename, mimeType, folderId = null) {
  const drive = createDriveClient();

  const media = {
    mimeType,
    body: stream.Readable.from(buffer)
  };

  const resource = { name: filename };
  if (folderId) resource.parents = [folderId];

  const res = await drive.files.create({
    requestBody: resource,
    media,
    fields: "id, name, mimeType"
  });

  const fileId = res.data.id;

  // If you want uploaded files publicly readable (not recommended), set MAKE_PUBLIC = "true"
  if (process.env.MAKE_PUBLIC === "true") {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" }
    });
    const { data } = await drive.files.get({
      fileId,
      fields: "webViewLink, webContentLink"
    });
    return {
      id: fileId,
      name: filename,
      mimeType,
      webViewLink: data.webViewLink,
      webContentLink: data.webContentLink
    };
  }

  return { id: fileId, name: filename, mimeType };
}

export async function streamFileFromDrive(res, fileId) {
  const drive = createDriveClient();

  const meta = await drive.files.get({ fileId, fields: "id, name, mimeType, size" });

  res.setHeader("Content-Type", meta.data.mimeType || "application/octet-stream");
  if (meta.data.size) res.setHeader("Content-Length", meta.data.size);
  res.setHeader("Content-Disposition", `inline; filename="${meta.data.name}"`);

  const driveStream = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  return new Promise((resolve, reject) => {
    driveStream.data
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .pipe(res, { end: true });
  });
}