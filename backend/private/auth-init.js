// ===============================
// auth-init.js  (SPA / PKCE only)
// ===============================

// ---- tenant/app config ----
const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com";
const CLIENT_ID    = "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT";

// If you need API tokens later, keep an audience (optional for cookie-only flows)
const AUDIENCE =
  location.hostname === "shreshthapushkar.com"
    ? "https://shree-drive.onrender.com"
    : "https://shree-drive.onrender.com"; // same for local

// Where to land after successful login (frontend handles callback)
const REDIRECT_AFTER_LOGIN = `${location.origin}/welcome.html`;

let auth0Client = null;

async function initAuth() {
  // Create SPA client (PKCE)
  auth0Client = await createAuth0Client({
    domain: AUTH0_DOMAIN,
    clientId: CLIENT_ID,
    cacheLocation: "localstorage",
    useRefreshTokens: true,
    // You can omit audience if you don't need access tokens.
    authorizationParams: { audience: AUDIENCE }
  });

  // ----------------------------
  // Handle Auth0 redirect (code/state) on any page
  // ----------------------------
  const qs = new URLSearchParams(location.search);
  if (qs.has("code") && qs.has("state")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      // Clean URL & go to welcome
      history.replaceState({}, document.title, REDIRECT_AFTER_LOGIN);
      return;
    }
  }

  // ----------------------------
  // If already logged in and on index -> go to welcome
  // ----------------------------
  const onIndex =
    location.pathname === "/" ||
    location.pathname.endsWith("/index.html");

  try {
    const isAuth = await auth0Client.isAuthenticated();
    if (isAuth && onIndex) {
      location.replace(REDIRECT_AFTER_LOGIN);
      return;
    }
  } catch (_) {}

  // ----------------------------
  // Wire the "Login" button
  // ----------------------------
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      try {
        await auth0Client.loginWithRedirect({
          authorizationParams: {
            audience: AUDIENCE
          },
          redirect_uri: REDIRECT_AFTER_LOGIN
        });
      } catch (e) {
        console.error("loginWithRedirect failed:", e);
      }
    });
  }
}

// Get an API token if you need it (safe to call; returns "" on failure)
async function getAuthToken() {
  try {
    if (!auth0Client) return "";
    return await auth0Client.getTokenSilently({
      detailedResponse: false,
      authorizationParams: { audience: AUDIENCE }
    });
  } catch (e) {
    console.warn("getTokenSilently error:", e);
    return "";
  }
}

// Hard logout: clear local state + Auth0 session, return to home
async function logoutToHome() {
  try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
  const returnTo = `${location.origin}/index.html`;
  const url =
    `https://${AUTH0_DOMAIN}/v2/logout` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&returnTo=${encodeURIComponent(returnTo)}`;
  // Use replace so back button can't return to private pages
  location.replace(url);
}

// Expose helpers globally (used by other pages)
window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;

// Boot
window.addEventListener("load", initAuth);
