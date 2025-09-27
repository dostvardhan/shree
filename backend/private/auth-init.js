<!-- load the SDK before this file -->
<script src="/auth0-spa-js.production.js"></script>
<script>
  // --- Choose the right Audience per hostname (must match Auth0 API Identifier) ---
  const AUDIENCE =
    (location.hostname === "shreshthapushkar.com")
      ? "https://shreshthapushkar.com"
      : "https://shree-drive.onrender.com";

  // Single callback path we'll register in Auth0
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

    // If we’re returning from Auth0
    if (location.search.includes("code=") && location.search.includes("state=")) {
      try {
        await auth0Client.handleRedirectCallback();
      } catch (e) {
        console.error("Auth0 callback error:", e);
      } finally {
        history.replaceState({}, document.title, "/life.html");
      }
    }

    // Wire login button (if present)
    const loginBtn = document.getElementById("btn-login");
    if (loginBtn) {
      loginBtn.addEventListener("click", async () => {
        await auth0Client.loginWithRedirect({ redirect_uri: REDIRECT_URI });
      });
    }

    // Optional: auto-guard — if a page requires auth, kick to login
    // const isAuth = await auth0Client.isAuthenticated();
    // if (!isAuth) await auth0Client.loginWithRedirect({ redirect_uri: REDIRECT_URI });
  }

  // Helpers you might call elsewhere
  async function getAuthToken() {
    return auth0Client ? auth0Client.getTokenSilently() : "";
  }
  async function logoutToHome() {
    await auth0Client.logout({ logoutParams: { returnTo: location.origin } });
  }

  window.getAuthToken = getAuthToken;
  window.logoutToHome = logoutToHome;

  window.addEventListener("load", initAuth);
</script>
