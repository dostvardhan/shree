const { v2: cloudinary } = require('cloudinary');
const formidable = require('formidable');
const fs = require('fs');
const path = require('path');

// Cloudinary config from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.handler = async (event, context) => {
  // Only allow POST method
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Check Netlify Identity user
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: 'Unauthorized: Login required' };
  }

  const form = formidable({ multiples: false });

  return new Promise((resolve) => {
    form.parse(event, async (err, fields, files) => {
      if (err) {
        resolve({ statusCode: 500, body: 'Form parse error: ' + err.toString() });
        return;
      }

      const file = files.photo;
      const quote = fields.quote || '';

      if (!file) {
        resolve({ statusCode: 400, body: 'No photo uploaded' });
        return;
      }

      try {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(file.filepath, {
          folder: 'private_nadaniya_uploads',
          use_filename: true,
          unique_filename: true,
          overwrite: false,
        });

        // Save post to cloudPosts.json (or your existing cloudPosts logic)
        const galleryPath = path.join(__dirname, 'cloudPosts.json');
        let posts = [];
        try {
          posts = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
        } catch (e) {}

        posts.unshift({ photo: result.secure_url, quote });
        fs.writeFileSync(galleryPath, JSON.stringify(posts, null, 2));

        resolve({ statusCode: 200, body: 'Uploaded successfully' });
      } catch (e) {
        resolve({ statusCode: 500, body: 'Upload failed: ' + e.message });
      }
    });
  });
};
