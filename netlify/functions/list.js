// netlify/functions/list.js

// Import cloudPosts data
const cloudPosts = require('./cloudPosts');

exports.handler = async function(event, context) {
  try {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cloudPosts),
    };
  } catch (error) {
    console.error("Error fetching cloudPosts:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch posts" }),
    };
  }
};
