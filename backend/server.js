// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "express-jwt";
import jwksRsa from "jwks-rsa";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Auth0 config
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN; // e.g. dev-xxxxxx.us.auth0.com (no https)
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || "https://shree-drive.onrender.com";

// ✅ Auth0 JWT middleware
const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  }),
  audience: AUTH0_AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  algorithms: ["RS256"],
});

// Health check
app.get("/api/diag", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ✅ Protected routes start here
app.use("/api", checkJwt);

// /api/list route
app.get("/api/list", async (req, res) => {
  try {
    // photos.json file ka path
    const filePath = path.join(process.cwd(), "backend", "photos.json");

    let items = [];
    try {
      const raw = await fs.readFile(filePath, "utf8");
      items = JSON.parse(raw);
      if (!Array.isArray(items)) items = [];
    } catch (err) {
      console.warn("[WARN] Could not read photos.json, returning empty list:", err.message);
      items = [];
    }

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("Error in /api/list:", err.message);
    return res.status(500).json({ error: "Failed to read list" });
  }
});

// Global error handler for auth
app.use(function (err, req, res, next) {
  if (err.name === "UnauthorizedError") {
    console.error("Auth error:", err.message);
    return res.status(401).json({ message: "Invalid token", error: err.message });
  }
  next(err);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
