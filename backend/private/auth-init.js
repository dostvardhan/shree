let auth0Client;

async function initAuth() {
  // ✅ Initialize Auth0 client
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    clientId: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    authorizationParams: {
      redirect_uri: window.location.origin + "/life.html",
      audience: "https://shree-drive.onrender.com"
    },
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  const loginBtn = document.getElementById("login-btn");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      await auth0Client.loginWithRedirect();
    });
  }

  // ✅ Handle redirect after login
  const query = window.location.search;
  if (query.includes("code=") && query.includes("state=")) {
    await auth0Client.handleRedirectCallback();
    window.history.replaceState({}, document.title, "/life.html");
  }

  // ✅ Check login state
  const isAuthenticated = await auth0Client.isAuthenticated();
  if (isAuthenticated && window.location.pathname === "/index.html") {
    window.location.href = "/life.html";
  }
}

initAuth().catch(err => console.error("Auth init error:", err));
