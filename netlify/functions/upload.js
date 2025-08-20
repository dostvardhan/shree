// netlify/functions/upload.js
const Busboy = require('busboy');
const { v2: cloudinary } = require('cloudinary');
const { addPost } = require('./cloudPosts');

// Cloudinary config from env (Netlify Environment Variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Netlify Identity check (private upload)
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: 'Unauthorized: Login required' };
  }

  return new Promise((resolve) => {
    try {
      const bb = Busboy({ headers: event.headers });
      const fields = {};
      let gotFile = false;

      bb.on('field', (name, val) => { fields[name] = val; });

      bb.on('file', (name, file, info) => {
        gotFile = true;
        const { filename, mimeType } = info;

        const uploadOpts = {
          folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'private_nadaniya_uploads',
          resource_type: 'image',
          use_filename: true,
          unique_filename: true,
          overwrite: false
        };

        const stream = cloudinary.uploader.upload_stream(uploadOpts, async (err, result) => {
          if (err) {
            resolve({ statusCode: 500, body: 'Cloudinary error: ' + err.message });
            return;
          }
          try {
            await addPost(result.secure_url, fields.quote || '');
            resolve({ statusCode: 200, body: 'Uploaded successfully' });
          } catch (e) {
            resolve({ statusCode: 500, body: 'Save failed: ' + e.message });
          }
        });

        file.on('data', (data) => stream.write(data));
        file.on('end', () => stream.end());
      });

      bb.on('finish', () => {
        if (!gotFile) {
          resolve({ statusCode: 400, body: 'No photo uploaded' });
        }
      });

      // Body ko proper Buffer me pass karo
      const body = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64')
        : Buffer.from(event.body || '', 'utf8');

      bb.end(body);
    } catch (e) {
      resolve({ statusCode: 500, body: 'Upload parse failed: ' + e.message });
    }
  });
};
