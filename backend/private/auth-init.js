<script>
  // Prod vs Local audience
  const AUDIENCE =
    location.hostname === "shreshthapushkar.com"
      ? "https://shree-drive.onrender.com"   // 👈 API identifier (Auth0 → APIs → “shreshthapushkar new”)
      : "https://shree-drive.onrender.com";

  const REDIRECT_URI = `${location.origin}/auth/callback`;

  let auth0Client = null;

  async function initAuth() {
    auth0Client = await createAuth0Client({
      domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
      client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
      cacheLocation: "localstorage",
      useRefreshTokens: true
    });

    // Handle Auth0 redirect
    if (location.search.includes("code=") && location.search.includes("state=")) {
      try {
        await auth0Client.handleRedirectCallback();
      } catch (e) {
        console.error("Auth0 callback error:", e);
      } finally {
        history.replaceState({}, document.title, "/welcome.html");
      }
    }

    // Already logged in? (only on index)
    if (location.pathname === "/" || location.pathname.endsWith("index.html")) {
      try {
        const ok = await auth0Client.isAuthenticated();
        if (ok) return (location.href = "/welcome.html");
      } catch {}
    }

    // Login button → top-level params (NO authorizationParams wrapper)
    const btn = document.getElementById("btn-login");
    if (btn) {
      btn.addEventListener("click", async () => {
        await auth0Client.loginWithRedirect({
          redirect_uri: REDIRECT_URI,
          audience: AUDIENCE,
          scope: "openid profile email offline_access"
        });
      });
    }
  }

  // Token helper
  async function getAuthToken() {
    try { return auth0Client ? await auth0Client.getTokenSilently() : ""; }
    catch { return ""; }
  }

  // Hard logout → Auth0 session bhi clear
  async function logoutToHome() {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    const url =
      "https://dev-zzhjbmtzoxtgoz31.us.auth0.com/v2/logout" +
      "?client_id=6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT" +
      "&returnTo=" + encodeURIComponent(location.origin + "/index.html");
    location.href = url;
  }

  window.getAuthToken = getAuthToken;
  window.logoutToHome = logoutToHome;
  window.addEventListener("load", initAuth);
</script>
