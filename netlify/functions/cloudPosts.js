// netlify/functions/cloudPosts.js
// Persistent gallery store via Netlify Blobs (no local filesystem)

const STORE_NAME = 'nadaniya';      // logical bucket name
const KEY = 'posts.json';           // single json list

// helper: get store (ESM module ko CJS me dynamic import se laa rahe)
async function getStore() {
  const mod = await import('@netlify/blobs');
  // getStore(name) auto-authenticated inside Netlify Functions runtime
  return mod.getStore(STORE_NAME);
}

async function readPosts() {
  const store = await getStore();
  const text = await store.get(KEY, { type: 'text' }); // returns null if not set
  if (!text) return [];
  try { return JSON.parse(text); } catch (_) { return []; }
}

async function writePosts(posts) {
  const store = await getStore();
  await store.set(KEY, JSON.stringify(posts), {
    contentType: 'application/json; charset=utf-8'
  });
}

/**
 * Add a new post to the start of the list.
 * @param {string} photo - Cloudinary secure URL
 * @param {string} quote - Optional caption/quote
 * @returns {Promise<object>} new post
 */
async function addPost(photo, quote) {
  const posts = await readPosts();
  const newPost = {
    id: Date.now().toString(),
    photo,
    quote: quote || '',
    ts: new Date().toISOString()
  };
  posts.unshift(newPost);
  await writePosts(posts);
  return newPost;
}

// Export utility for other functions (upload.js will call this)
exports.addPost = addPost;

// Netlify Function handler to READ posts (login required)
exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (event.httpMethod === 'GET') {
    const posts = await readPosts();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posts)
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
