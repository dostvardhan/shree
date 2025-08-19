const { getSavedPosts } = require('./cloudPosts');

exports.handler = async () => {
  try {
    const posts = await getSavedPosts();
    posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { statusCode: 200, body: JSON.stringify({ posts }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
