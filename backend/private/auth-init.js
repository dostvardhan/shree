let auth0Client = null;

async function initAuth() {
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",   // ✅ your Auth0 domain
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT", // ✅ your Auth0 client ID
    audience: "https://shree-drive.onrender.com",  // ✅ API audience
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  // Handle redirect callback
  if (window.location.search.includes("code=") &&
      window.location.search.includes("state=")) {
    try {
      await auth0Client.handleRedirectCallback();
      window.history.replaceState({}, document.title, "/life.html");
    } catch (err) {
      console.error("Auth0 callback error:", err);
    }
  }

  // Login button
  const loginBtn = document.getElementById("btn-login");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      await auth0Client.loginWithRedirect({
        redirect_uri: window.location.origin + "/auth/callback"
      });
    });
  }
}

window.onload = initAuth;
