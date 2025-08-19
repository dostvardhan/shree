const cloudinary = require('cloudinary').v2;
const { getPosts } = require('./cloudPosts');

exports.handler = async () => {
  try {
    const posts = await getPosts(); // fetch from Cloudinary metadata or KV store
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, photos: posts })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
