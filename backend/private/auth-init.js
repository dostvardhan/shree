// ✅ Load AFTER /auth0-spa-js.production.js

const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com";
const CLIENT_ID = "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT";

const AUDIENCE =
  location.hostname === "shreshthapushkar.com"
    ? "https://shree-drive.onrender.com" // ✅ use API identifier
    : "https://shree-drive.onrender.com";

const REDIRECT_URI = `${location.origin}/auth/callback`;

let auth0Client = null;

async function initAuth() {
  auth0Client = await createAuth0Client({
    domain: AUTH0_DOMAIN,
    client_id: CLIENT_ID,
    audience: AUDIENCE,
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  // ✅ Handle login callback from Auth0
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      return (location.href = "/welcome.html");
    }
  }

  // ✅ Prevent auto-login after logout
  if (location.pathname === "/" || location.pathname.endsWith("index.html")) {
    const isAuth = await auth0Client.isAuthenticated();
    if (isAuth) return (location.href = "/welcome.html");
  }

  // ✅ Manual login (button)
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      await auth0Client.loginWithRedirect({
        authorizationParams: {
          redirect_uri: REDIRECT_URI,
          audience: AUDIENCE,
          scope: "openid profile email offline_access"
        }
      });
    });
  }
}

// ✅ Get Access Token
async function getAuthToken() {
  try {
    return await auth0Client.getTokenSilently();
  } catch {
    return "";
  }
}

// ✅ Logout Properly (no auto re-login)
async function logoutToHome() {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  location.href =
    `https://${AUTH0_DOMAIN}/v2/logout?client_id=${CLIENT_ID}&returnTo=${encodeURIComponent(location.origin + "/index.html")}`;
}

window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;

window.addEventListener("load", initAuth);
