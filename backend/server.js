// backend/server.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import stream from 'stream';
import { checkJwt } from './auth-mw.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
// Serve static from repo root (adjust if your static lives elsewhere)
app.use(express.static(path.join(process.cwd(), '..')));

const upload = multer({ storage: multer.memoryStorage() });

const PHOTOS_JSON = process.env.PHOTOS_JSON || path.join(process.cwd(), 'photos.json');
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!fs.existsSync(PHOTOS_JSON)) fs.writeFileSync(PHOTOS_JSON, JSON.stringify([]));

function readPhotos() {
  try { return JSON.parse(fs.readFileSync(PHOTOS_JSON, 'utf8')); }
  catch (e) { return []; }
}
function writePhotos(arr) { fs.writeFileSync(PHOTOS_JSON, JSON.stringify(arr, null, 2)); }

function createDriveClient() {
  const oAuth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oAuth2Client });
}

// Health
app.get('/api/diag', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Upload endpoint
app.post('/api/upload', checkJwt, upload.single('photo'), async (req, res) => {
  try {
    const userEmail = req.user && (req.user.email || req.user['https://example.com/email']);
    if (!userEmail) return res.status(400).json({ error: 'email_missing_in_token' });
    if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(userEmail)) return res.status(403).json({ error: 'user_not_allowed' });

    if (!req.file) return res.status(400).json({ error: 'no_file' });

    const drive = createDriveClient();
    const fileMetadata = { name: `${Date.now()}_${req.file.originalname}` };
    if (GOOGLE_DRIVE_FOLDER_ID) fileMetadata.parents = [GOOGLE_DRIVE_FOLDER_ID];

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const created = await drive.files.create({
      requestBody: fileMetadata,
      media: { mimeType: req.file.mimetype, body: bufferStream },
      fields: 'id, name, mimeType, size'
    });

    const fileId = created.data.id;
    const item = {
      id: fileId,
      name: created.data.name,
      caption: req.body.caption || '',
      uploadedBy: userEmail,
      mimeType: created.data.mimeType,
      size: created.data.size || null,
      time: new Date().toISOString()
    };

    const photos = readPhotos();
    photos.unshift(item);
    writePhotos(photos);

    // send response
    return res.json({ ok: true, item });
  } catch (err) {
    console.error('upload error', err);
    return res.status(500).json({ error: 'upload_failed', details: err.message });
  }
});

// List endpoint
app.get('/api/list', checkJwt, (req, res) => {
  const limit = parseInt(req.query.limit || '0');
  const arr = readPhotos();
  if (limit > 0) return res.json(arr.slice(0, limit));
  return res.json(arr);
});

// File streaming endpoint
app.get('/api/file/:id', checkJwt, async (req, res) => {
  try {
    const id = req.params.id;
    const drive = createDriveClient();
    const meta = await drive.files.get({ fileId: id, fields: 'id,name,mimeType,size' });
    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${meta.data.name || id}"`);

    const streamRes = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'stream' });
    streamRes.data.pipe(res);
  } catch (err) {
    console.error('file stream error', err);
    return res.status(500).json({ error: 'file_stream_failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on ${PORT}`));
