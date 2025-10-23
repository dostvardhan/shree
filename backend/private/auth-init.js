// load AFTER /auth0-spa-js.production.js

// ✅ Correct API Audience (must match Auth0 "Identifier")
const AUDIENCE = "https://shree-drive.onrender.com";

// ✅ Redirect after Auth0 login success
const REDIRECT_URI = `${location.origin}/auth/callback`;

let auth0Client = null;

async function initAuth() {
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    audience: AUDIENCE,        // ✅ Correct now
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  // ✅ Handle Auth0 → app redirect
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      history.replaceState({}, document.title, "/welcome.html");
    }
  }

  // ✅ Prevent auto-login after logout on index.html
  if (location.pathname === "/" || location.pathname.endsWith("index.html")) {
    const isAuth = await auth0Client.isAuthenticated();
    if (isAuth) {
      return (location.href = "/welcome.html");
    }
  }

  // ✅ Login button → Auth0 page
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      await auth0Client.loginWithRedirect({ redirect_uri: REDIRECT_URI });
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

// ✅ Full logout (no auto session restore)
async function logoutToHome() {
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}

  const logoutURL =
    "https://dev-zzhjbmtzoxtgoz31.us.auth0.com/v2/logout" +
    "?client_id=6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT" +
    "&returnTo=" + encodeURIComponent(location.origin + "/index.html");

  location.href = logoutURL;
}

window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;

window.addEventListener("load", initAuth);
