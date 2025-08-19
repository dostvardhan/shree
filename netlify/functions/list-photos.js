// Netlify Function: list uploaded images (for logged-in users)
exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, body: "Not authorized" };

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || "";

  const expression = folder ? `folder="${folder}"` : 'resource_type:image';
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/search`;
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expression,
      sort_by: [{ public_id: "desc" }],
      max_results: 50,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { statusCode: res.status, body: text };
  }

  const data = await res.json();
  const photos = (data.resources || []).map(r => ({
    url: r.secure_url,
    public_id: r.public_id,
    created_at: r.created_at,
  }));

  return { statusCode: 200, body: JSON.stringify({ photos }) };
};
