import fetch from "node-fetch";

export async function handler(event, context) {
  // ✅ 1. Check if user is logged in (Netlify Identity JWT)
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Not authorized. Please log in." }),
    };
  }

  // ✅ 2. Parse file from request body
  const body = JSON.parse(event.body);
  const { file } = body;

  if (!file) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No file provided" }),
    };
  }

  // ✅ 3. Upload to Cloudinary
  const cloudName = "db2qviypg"; // <-- apna cloud name daalo
  const uploadPreset = "your_upload_preset"; // <-- apna preset daalo

  try {
    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: "POST",
        body: new URLSearchParams({
          file: file,
          upload_preset: uploadPreset,
        }),
      }
    );

    const data = await uploadResponse.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Upload successful",
        url: data.secure_url,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Upload failed", details: err.message }),
    };
  }
}
