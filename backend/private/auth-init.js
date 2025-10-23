// backend/private/auth-init.js
// load AFTER /auth0-spa-js.production.js

const AUDIENCE =
  (location.hostname === "shreshthapushkar.com")
    ? "https://shreshthapushkar.com"
    : "https://shree-drive.onrender.com";

const REDIRECT_URI = `${location.origin}/auth/callback`;

let auth0Client = null;

async function initAuth() {
  // Create client using v2 shape: authorizationParams inside createAuth0Client
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    cacheLocation: "localstorage",
    useRefreshTokens: true,
    authorizationParams: {
      redirect_uri: REDIRECT_URI,
      audience: AUDIENCE,
      scope: "openid profile email offline_access"
    }
  });

  // handle redirect callback (Auth0 -> our site)
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      // replace history so URL is clean and then go to welcome page
      history.replaceState({}, document.title, "/welcome.html");
      location.href = "/welcome.html";
    }
  }

  // If index page and already authed -> go to welcome
  if (location.pathname === "/" || location.pathname.endsWith("index.html")) {
    try {
      const isAuth = await auth0Client.isAuthenticated();
      if (isAuth) {
        location.href = "/welcome.html";
        return;
      }
    } catch (e) {
      console.warn("isAuthenticated check failed", e);
    }
  }

  // wire login button to SDK loginWithRedirect (no nested authorizationParams here)
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      // NOTE: do NOT send an object that will be serialized incorrectly.
      // Since we passed authorizationParams in createAuth0Client, we can call without args:
      await auth0Client.loginWithRedirect();
    });
  }
}

async function getAuthToken() {
  try {
    return auth0Client ? await auth0Client.getTokenSilently() : "";
  } catch (e) {
    console.warn("Token fetch error:", e);
    return "";
  }
}

async function logoutToHome() {
  try { localStorage.clear(); sessionStorage.clear(); } catch(e){}
  // Use universal logout (v2 endpoint)
  const logoutURL =
    "https://dev-zzhjbmtzoxtgoz31.us.auth0.com/v2/logout" +
    "?client_id=" + encodeURIComponent("6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT") +
    "&returnTo=" + encodeURIComponent(location.origin + "/index.html");
  location.href = logoutURL;
}

window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;
window.addEventListener("load", initAuth);
