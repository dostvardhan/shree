const cloudinary = require('cloudinary').v2;
const { savePost } = require('./cloudPosts');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const Busboy = require('busboy');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const bb = Busboy({ headers: event.headers });
    let fileBuffer = null;
    let quote = '';
    let timestamp = '';

    bb.on('file', (name, file) => {
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => fileBuffer = Buffer.concat(chunks));
    });

    bb.on('field', (name, val) => {
      if (name === 'quote') quote = val;
      if (name === 'timestamp') timestamp = val;
    });

    await new Promise((resolve, reject) => {
      bb.on('finish', resolve);
      bb.on('error', reject);
      bb.end(Buffer.from(event.body, 'base64'));
    });

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ resource_type: 'image' }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }).end(fileBuffer);
    });

    await savePost({ url: result.secure_url, quote, timestamp });

    return { statusCode: 200, body: JSON.stringify({ success: true, url: result.secure_url }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
