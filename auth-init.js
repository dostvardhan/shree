// auth-init.js
// Put this file in repo root (same dir as upload.html).
// Replace placeholders below before use.

const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com";       // e.g. dev-zzhjbmtzoxtgoz31.us.auth0.com
const AUTH0_CLIENT_ID = "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT";  // e.g. 6sf0...
const AUTH0_AUDIENCE = "https://shree-drive.onrender.com";    // e.g. https://shree-drive.onrender.com

let AUTH0_CLIENT = null;

/**
 * Initialize (or return cached) Auth0 client.
 * Returns the auth0 client instance.
 */
export async function getAuth0Client() {
  if (AUTH0_CLIENT) return AUTH0_CLIENT;

  if (!window.createAuth0Client) {
    throw new Error("Auth0 SDK not loaded (createAuth0Client missing). Ensure CDN script is present.");
  }

  AUTH0_CLIENT = await createAuth0Client({
    domain: AUTH0_DOMAIN,
    client_id: AUTH0_CLIENT_ID,
    cacheLocation: "localstorage",
    useRefreshTokens: true,
    authorizationParams: {
      audience: AUTH0_AUDIENCE
    }
  });

  return AUTH0_CLIENT;
}

/**
 * Helper to ensure path ends with .html (fallback to /upload.html)
 */
export function ensureHtmlPath(p) {
  if (!p) return "/upload.html";
  if (p.endsWith(".html")) return p;
  if (p === "/" || p === "") return "/upload.html";
  return p + ".html";
}
