// Netlify Function: returns Cloudinary signed params
const crypto = require("crypto");

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, body: "Not authorized" };

  const timestamp = Math.floor(Date.now() / 1000);

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || "";

  // params to sign (alphabetical join)
  const params = [
    `timestamp=${timestamp}`,
    `upload_preset=${uploadPreset}`,
    ...(folder ? [`folder=${folder}`] : []),
  ].sort().join("&");

  const signature = crypto
    .createHash("sha1")
    .update(params + apiSecret)
    .digest("hex");

  return {
    statusCode: 200,
    body: JSON.stringify({
      timestamp,
      signature,
      apiKey,
      cloudName,
      uploadPreset,
      folder,
    }),
  };
};
