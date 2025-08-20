const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  const filePath = path.join(__dirname, 'gallery.json');
  let posts = [];
  try {
    posts = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.log('No gallery.json yet, returning empty array');
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(posts)
  };
};
