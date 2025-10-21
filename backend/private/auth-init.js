// load AFTER /auth0-spa-js.production.js

// --- invited emails (lowercase) ---
const INVITED_EMAILS = [
  "dostvardhan@gmail.com",
  "mitravardhan@gmail.com",
  "jhilmilsiyaadein@gmail.com"
];

// API audience (keep if you need Drive API proxy with bearer)
const AUDIENCE =
  (location.hostname === "shreshthapushkar.com")
    ? "https://shreshthapushkar.com"
    : "https://shree-drive.onrender.com";

// We will return to index.html after login (simpler than /auth/callback)
const REDIRECT_URI = `${location.origin}/index.html`;

let auth0Client = null;

async function initAuth() {
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    audience: AUDIENCE,
    cacheLocation: "localstorage",
    useRefreshTokens: true,
    authorizationParams: {
      redirect_uri: REDIRECT_URI,
      scope: "openid profile email offline_access"
    }
  });

  // If we came back from Auth0 with code/state, finalize login
  if (location.search.includes("code=") && location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
    } catch (e) {
      console.error("Auth0 callback error:", e);
    } finally {
      // clean ?code= from URL (stay on the same page)
      history.replaceState({}, document.title, location.pathname);
    }
  }

  // Wire login button (index.html must have id="btn-login")
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      try {
        await auth0Client.loginWithRedirect();
      } catch (e) {
        console.error("loginWithRedirect failed", e);
      }
    });
  }

  // If already authenticated, enforce allow-list
  try {
    if (await auth0Client.isAuthenticated()) {
      const user = await auth0Client.getUser();
      const email = (user && user.email ? user.email : "").toLowerCase();

      if (INVITED_EMAILS.includes(email)) {
        // Allowed → go to welcome
        if (!/\/welcome\.html$/i.test(location.pathname)) {
          location.href = "/welcome.html";
        }
      } else {
        // Not allowed → polite message + logout to index
        showInviteMessage("Sorry! This account isn't on the invite list.");
        setTimeout(() => logoutToHome(), 1200);
      }
    }
  } catch (e) {
    console.warn("auth check failed", e);
  }
}

// Small helper to show message on pages that have #inviteMsg
function showInviteMessage(text) {
  const el = document.getElementById("inviteMsg");
  if (el) {
    el.textContent = text;
    el.style.display = "block";
  } else {
    alert(text);
  }
}

async function getAuthToken() {
  return auth0Client ? auth0Client.getTokenSilently() : "";
}

async function logoutToHome() {
  if (!auth0Client) {
    location.href = "/";
    return;
  }
  try {
    await auth0Client.logout({ logoutParams: { returnTo: location.origin + "/index.html" } });
  } catch {
    location.href = "/index.html";
  }
}

window.getAuthToken = getAuthToken;
window.logoutToHome = logoutToHome;
window.addEventListener("load", initAuth);
