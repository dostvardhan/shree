<!-- /auth0-spa-js.production.js के बाद लोड हो -->
<script>
  // === Config ===
  const AUDIENCE =
    (location.hostname === "shreshthapushkar.com")
      ? "https://shree-drive.onrender.com"   // <- यही audience यूज़ करें (Auth0 API identifier)
      : "https://shree-drive.onrender.com";

  const REDIRECT_URI = location.origin + "/welcome.html";

  let auth0Client = null;

  async function initAuth() {
    auth0Client = await createAuth0Client({
      domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
      client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",  // NOTE: client_id (snake_case)
      audience: AUDIENCE,
      cacheLocation: "localstorage",
      useRefreshTokens: true
      // NOTE: यहाँ authorizationParams नहीं भेजना
    });

    // Callback handle (अगर code/state आए तो)
    if (location.search.includes("code=") && location.search.includes("state=")) {
      try { await auth0Client.handleRedirectCallback(); }
      catch (e) { console.error("Auth0 callback error:", e); }
      finally {
        history.replaceState({}, document.title, "/welcome.html");
        return;
      }
    }

    // Index पर already logged-in हो तो welcome भेज दो
    if (location.pathname === "/" || location.pathname.endsWith("index.html")) {
      try {
        if (await auth0Client.isAuthenticated()) {
          location.replace("/welcome.html");
          return;
        }
      } catch (e) {}
    }

    // Login बटन – सही top-level params
    const btn = document.getElementById("btn-login");
    if (btn) {
      btn.addEventListener("click", async () => {
        await auth0Client.loginWithRedirect({
          redirect_uri: REDIRECT_URI,          // top-level
          audience: AUDIENCE,                  // top-level
          scope: "openid profile email offline_access"  // top-level
          // authorizationParams मत भेजो
        });
      });
    }
  }

  // Token helper
  async function getAuthToken() {
    try { return auth0Client ? await auth0Client.getTokenSilently() : ""; }
    catch (e) { console.warn("token error", e); return ""; }
  }

  // Hard logout (Auth0 session भी clear)
  async function logoutToHome() {
    try { localStorage.clear(); sessionStorage.clear(); } catch(e) {}
    const url = "https://dev-zzhjbmtzoxtgoz31.us.auth0.com/v2/logout"
      + "?client_id=6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT"
      + "&returnTo=" + encodeURIComponent(location.origin + "/index.html");
    location.href = url;
  }

  window.getAuthToken = getAuthToken;
  window.logoutToHome = logoutToHome;
  window.addEventListener("load", initAuth);
</script>
