const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join("/tmp", "uploads.json");

exports.handler = async () => {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.writeFileSync(UPLOADS_DIR, JSON.stringify([]));
    }

    const posts = JSON.parse(fs.readFileSync(UPLOADS_DIR));

    return {
      statusCode: 200,
      body: JSON.stringify(posts),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
