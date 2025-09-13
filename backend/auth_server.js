// auth_server.js (CommonJS)
const express = require("express");
const { google } = require("googleapis");
require("dotenv").config();

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:3000/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing CLIENT_ID or CLIENT_SECRET in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

app.get("/", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
  return res.send(`<h3>Login as jhilmil (use jhilmil Google account)</h3>
    <p><a href="${url}" target="_blank">Click here to authorize</a></p>`);
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code in query");

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.setHeader("Content-Type", "text/html");
    res.write("<h3>Tokens received — copy the refresh_token below:</h3>");
    res.write("<pre>" + JSON.stringify(tokens, null, 2) + "</pre>");
    res.end();
    console.log("=== TOKENS ===\n", tokens);
  } catch (err) {
    console.error("Error exchanging code:", err);
    res.status(500).send("Token exchange failed: " + (err.message || err));
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running: open http://localhost:${PORT} in your browser`);
});
