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
    audience: AUDIENCE,
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  // handle Auth0 redirect -> welcome
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try { await auth0Client.handleRedirectCallback(); }
    catch (e) { console.error("Auth0 callback error:", e); }
    finally { history.replaceState({}, document.title, "/welcome.html"); }
  }

  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      await auth0Client.loginWithRedirect({ redirect_uri: REDIRECT_URI });
    });
  }
}

async function getAuthToken() {
  return auth0Client ? auth0Client.getTokenSilently() : "";
}

async function logoutToHome() {
  if (!auth0Client) return (location.href = "/");
  await auth0Client.logout({ logoutParams: { returnTo: location.origin } });
}

window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;

window.addEventListener("load", initAuth);