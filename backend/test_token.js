// test_token.js
const { google } = require("googleapis");
require("dotenv").config();

async function main(){
  const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!CLIENT_ID || !CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.error("Missing CLIENT_ID / CLIENT_SECRET / GOOGLE_REFRESH_TOKEN in .env");
    process.exit(1);
  }
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI || "http://localhost:3000/oauth2callback");
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  try {
    const at = await oauth2Client.getAccessToken();
    console.log("ACCESS TOKEN RESULT:", at && at.token ? "OK" : at);
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const about = await drive.about.get({ fields: "user,storageQuota" });
    console.log("DRIVE ABOUT USER:", about.data.user);
    console.log("DRIVE QUOTA:", about.data.storageQuota);
    process.exit(0);
  } catch (e) {
    console.error("TOKEN TEST ERROR:");
    if (e.response && e.response.data) console.error(JSON.stringify(e.response.data, null, 2));
    else console.error(e.message || e);
    process.exit(2);
  }
}

main();
