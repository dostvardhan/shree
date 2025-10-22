// load AFTER /auth0-spa-js.production.js

// Production vs Local Audience (for tokens)
const AUDIENCE =
  location.hostname === "shreshthapushkar.com"
    ? "https://shreshthapushkar.com"
    : "https://shree-drive.onrender.com";

// Redirect after Auth0 login success
const REDIRECT_URI = `${location.origin}/auth/callback`;

let auth0Client = null;

async function initAuth() {
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    audience: AUDIENCE,
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  // ✅ Handle redirect back from Auth0 (login callback)
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      history.replaceState({}, document.title, "/welcome.html");
    }
  }

  // ✅ If user already logged in → go to welcome.html (from index only)
  if (location.pathname === "/" || location.pathname.endsWith("index.html")) {
    const isAuth = await auth0Client.isAuthenticated();
    if (isAuth) {
      return (location.href = "/welcome.html");
    }
  }

  // ✅ Login button → Auth0 login page
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      await auth0Client.loginWithRedirect({ redirect_uri: REDIRECT_URI });
    });
  }
}

// ✅ Helper to get API token
async function getAuthToken() {
  try {
    return auth0Client ? await auth0Client.getTokenSilently() : "";
  } catch (e) {
    console.warn("Token fetch error:", e);
    return "";
  }
}

// ✅ ✅ Final Logout — No auto-login after logout
async function logoutToHome() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {}

  // Force Auth0 session clear + redirect to index
  const logoutURL =
    "https://dev-zzhjbmtzoxtgoz31.us.auth0.com/v2/logout" +
    "?client_id=6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT" +
    "&returnTo=" + encodeURIComponent(location.origin + "/index.html");

  location.href = logoutURL;
}

// Expose to window
window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;

window.addEventListener("load", initAuth);
