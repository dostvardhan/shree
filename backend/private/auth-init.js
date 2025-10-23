// load AFTER /auth0-spa-js.production.js

// Audience per host
const AUDIENCE =
  location.hostname === "shreshthapushkar.com"
    ? "https://shreshthapushkar.com"
    : "https://shree-drive.onrender.com";

// Our callback route handled by server (or by SPA handler)
const REDIRECT_URI = `${location.origin}/auth/callback`;

let auth0Client = null;

async function initAuth() {
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    cacheLocation: "localstorage",
    useRefreshTokens: true,

    // ✅ put everything inside authorizationParams here
    authorizationParams: {
      audience: AUDIENCE,
      scope: "openid profile email offline_access",
      redirect_uri: REDIRECT_URI
    }
  });

  // ✅ Handle Auth0 code/state on callback then go to welcome
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      history.replaceState({}, document.title, "/welcome.html");
      return;
    }
  }

  // If already authenticated and currently on index → go to welcome
  if (location.pathname === "/" || location.pathname.endsWith("/index.html")) {
    try {
      if (await auth0Client.isAuthenticated()) {
        location.replace("/welcome.html");
        return;
      }
    } catch (e) {
      console.warn("isAuthenticated error:", e);
    }
  }

  // Login button → clean redirect (no extra params here!)
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      await auth0Client.loginWithRedirect();
    });
  }
}

// Token helper
async function getAuthToken() {
  try {
    return auth0Client ? await auth0Client.getTokenSilently() : "";
  } catch (e) {
    console.warn("Token error:", e);
    return "";
  }
}

// Hard logout → clear local & Auth0 session → back to index
async function logoutToHome() {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  const url =
    "https://dev-zzhjbmtzoxtgoz31.us.auth0.com/v2/logout" +
    "?client_id=6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT" +
    "&returnTo=" + encodeURIComponent(location.origin + "/index.html");
  location.replace(url);
}

window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;

window.addEventListener("load", initAuth);
