// For simplicity, using Cloudinary tags/metadata or Netlify KV
// Here using a fake in-memory array as placeholder
let posts = [];

module.exports.savePost = async ({ url, quote, timestamp }) => {
  posts.push({ url, quote, timestamp });
};

module.exports.getPosts = async () => {
  return posts;
};
