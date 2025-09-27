// Choose the right Audience per hostname (must match Auth0 API Identifier)
const AUDIENCE =
  (location.hostname === "shreshthapushkar.com")
    ? "https://shreshthapushkar.com"
    : "https://shree-drive.onrender.com";

// Single callback path we'll register in Auth0
const REDIRECT_URI = `${location.origin}/auth/callback`;

let auth0Client = null;

// A promise so other scripts can await auth init
window.authReady = (async () => {
  // Load the SPA client (auth0-spa-js.production.js must be loaded BEFORE this file)
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    audience: AUDIENCE,
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  // Handle Auth0 redirect callback (if present)
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      history.replaceState({}, document.title, "/life.html");
    }
  }

  return true;
})();

// Helpers (usable in pages)
async function getAuthToken() {
  await window.authReady;
  return auth0Client.getTokenSilently();
}
async function logoutToHome() {
  await window.authReady;
  await auth0Client.logout({ logoutParams: { returnTo: location.origin } });
}

// Make available globally
window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;
window.auth0Client = () => auth0Client;
window.REDIRECT_URI = REDIRECT_URI;
