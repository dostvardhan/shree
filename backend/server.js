// server.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import stream from 'stream';
import { verifyToken } from './auth-mw.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://shreshthapushkar.com';
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || null;

const app = express();
app.use(express.json());
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const upload = multer({ storage: multer.memoryStorage() });

// --- Google OAuth2 client using refresh token
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// --- Simple diag endpoint (not protected)
app.get('/diag', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- List files in Drive folder (protected)
app.get('/api/list', verifyToken, async (req, res) => {
  try {
    const q = DRIVE_FOLDER_ID ? `'${DRIVE_FOLDER_ID}' in parents` : '';
    const response = await drive.files.list({
      q,
      fields: 'files(id,name,mimeType,modifiedTime)',
      pageSize: 200,
      supportsAllDrives: true,
    });
    res.json({ files: response.data.files || [] });
  } catch (err) {
    console.error('Drive list error:', err);
    res.status(500).json({ error: 'drive list failed', details: err.message || err });
  }
});

// --- Upload file to Drive (protected)
app.post('/api/upload', verifyToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  try {
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const metadata = {
      name: req.file.originalname,
      parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined,
    };

    const response = await drive.files.create({
      requestBody: metadata,
      media: { mimeType: req.file.mimetype, body: bufferStream },
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });

    res.json({ success: true, file: response.data });
  } catch (err) {
    console.error('Drive upload error:', err);
    res.status(500).json({ error: 'upload failed', details: err.message || err });
  }
});

// --- Stream file to authenticated user (protected)
app.get('/api/file/:id', verifyToken, async (req, res) => {
  const fileId = req.params.id;
  try {
    const meta = await drive.files.get({
      fileId,
      fields: 'name,mimeType,size',
      supportsAllDrives: true,
    });

    res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${meta.data.name}"`);

    const driveRes = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );

    driveRes.data.pipe(res);
  } catch (err) {
    console.error('Drive stream error:', err);
    res.status(500).json({ error: 'file fetch failed', details: err.message || err });
  }
});

app.get('/health', (req, res) => res.send('alive'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
