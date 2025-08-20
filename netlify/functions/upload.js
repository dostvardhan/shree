const fs = require('fs');
const path = require('path');
const formidable = require('formidable');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const form = formidable({ multiples: false, uploadDir: path.join(__dirname, 'uploads'), keepExtensions: true });

  return new Promise((resolve, reject) => {
    form.parse(event, (err, fields, files) => {
      if (err) {
        reject({ statusCode: 500, body: err.toString() });
        return;
      }

      const photoPath = `/uploads/${path.basename(files.photo.path)}`;
      const quote = fields.quote || '';

      const galleryPath = path.join(__dirname, 'gallery.json');
      let posts = [];
      try {
        posts = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
      } catch (e) {}

      posts.unshift({ photo: photoPath, quote });
      fs.writeFileSync(galleryPath, JSON.stringify(posts, null, 2));

      resolve({ statusCode: 200, body: 'Uploaded successfully' });
    });
  });
};
