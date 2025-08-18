// netlify/functions/get-signature.js
import crypto from "crypto";

export async function handler(event) {
  try {
    const { timestamp } = JSON.parse(event.body);

    // Cloudinary credentials from Netlify environment variables
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    // Upload preset ka naam
    const uploadPreset = "daily_uploads";

    // Signature generate karna (preset + timestamp)
    const stringToSign = `timestamp=${timestamp}&upload_preset=${uploadPreset}${apiSecret}`;
    const signature = crypto
      .createHash("sha1")
      .update(stringToSign)
      .digest("hex");

    return {
      statusCode: 200,
      body: JSON.stringify({
        signature,
        timestamp,
        cloudName,
        apiKey,
        uploadPreset,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
