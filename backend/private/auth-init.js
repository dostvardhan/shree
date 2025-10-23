// backend/private/auth-init.js
// load AFTER /auth0-spa-js.production.js

const AUDIENCE =
  (location.hostname === "shreshthapushkar.com")
    ? "https://shreshthapushkar.com"
    : "https://shree-drive.onrender.com";

const REDIRECT_URI = `${location.origin}/auth/callback`;

let auth0Client = null;

async function initAuth() {
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    cacheLocation: "localstorage",
    useRefreshTokens: true,
    // pass redirect/audience/scope here (v2 pattern)
    authorizationParams: {
      redirect_uri: REDIRECT_URI,
      audience: AUDIENCE,
      scope: "openid profile email offline_access"
    }
  });

  // handle callback
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      history.replaceState({}, document.title, "/welcome.html");
      location.href = "/welcome.html";
    }
  }

  // auto-redirect if already authenticated (index only)
  if (location.pathname === "/" || location.pathname.endsWith("index.html")) {
    try {
      const isAuth = await auth0Client.isAuthenticated();
      if (isAuth) {
        location.href = "/welcome.html";
        return;
      }
    } catch (e) { console.warn("isAuthenticated failed", e); }
  }

  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      // call with no options (we set authorizationParams in createAuth0Client)
      await auth0Client.loginWithRedirect();
    });
  }
}

async function getAuthToken() {
  try { return auth0Client ? await auth0Client.getTokenSilently() : ""; }
  catch (e) { console.warn("Token fetch error:", e); return ""; }
}

async function logoutToHome() {
  try { localStorage.clear(); sessionStorage.clear(); } catch(e){}
  const logoutURL =
    "https://dev-zzhjbmtzoxtgoz31.us.auth0.com/v2/logout" +
    "?client_id=" + encodeURIComponent("6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT") +
    "&returnTo=" + encodeURIComponent(location.origin + "/index.html");
  location.href = logoutURL;
}

window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;
window.addEventListener("load", initAuth);
