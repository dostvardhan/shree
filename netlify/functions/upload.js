import { v2 as cloudinary } from 'cloudinary';
import formidable from 'formidable';
import * as admin from 'firebase-admin';

// ---------- Cloudinary config from env ----------
const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  FIREBASE_SERVICE_ACCOUNT_B64
} = process.env;

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET
});

// ---------- Firebase Admin init ----------
if (!admin.apps.length) {
  if (!FIREBASE_SERVICE_ACCOUNT_B64) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT_B64');
  }
  const serviceAccount = JSON.parse(
    Buffer.from(FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// ---------- Helper: parse multipart form ----------
function parseForm(event) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false });
    const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');

    form.parse(
      { headers: event.headers, on: (name, cb) => {} },
      (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      }
    );

    form.write(bodyBuffer);
    form.end();
  });
}

export const handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Require logged-in user
    const user = context.clientContext && context.clientContext.user;
    if (!user) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    const { fields, files } = await parseForm(event);
    const caption = String(fields.caption || '').slice(0, 2000);
    const file = files.file;

    if (!file) {
      return { statusCode: 400, body: 'No file uploaded' };
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(file.filepath || file.path, {
      folder: 'daily_uploads',
      resource_type: 'image',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }]
    });

    // Save to Firestore
    const doc = {
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      caption,
      user: {
        id: user.sub || user.id || null,
        email: user.email || null,
        name: user.user_metadata?.full_name || null
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('posts').add(doc);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ref.id, ...doc })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Upload failed: ' + err.message };
  }
};
