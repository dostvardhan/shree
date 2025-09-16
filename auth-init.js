// auth-init.js
// Dynamically load Auth0 SPA SDK (local vendor copy)
// Ensures createAuth0Client is available before initAuth runs
(function loadAuth0SDK(cb) {
  const script = document.createElement("script");
  script.src = "/auth0-spa-js.production.js"; // local copy in repo root
  script.onload = cb;
  script.onerror = () => {
    console.error("❌ Failed to load Auth0 SPA SDK script.");
    alert("Auth0 SDK failed to load — check /auth0-spa-js.production.js");
  };
  document.head.appendChild(script);
})(initAuth);

async function initAuth() {
  // Initialize Auth0 client
  window.auth0 = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    audience: "https://shree-drive.onrender.com",
    cacheLocation: "localstorage",
    useRefreshTokens: true,
  });

  console.log("✅ Auth0 client initialized", window.auth0);

  // Handle Auth0 login redirect callback
  if (
    window.location.search.includes("code=") &&
    window.location.search.includes("state=")
  ) {
    try {
      await window.auth0.handleRedirectCallback();
      window.history.replaceState({}, document.title, "/life.html");
    } catch (err) {
      console.error("❌ Auth0 callback error:", err);
    }
  }

  const isAuthenticated = await window.auth0.isAuthenticated();

  if (isAuthenticated) {
    console.log("✅ User already logged in");
    // Redirect to life.html if on index
    if (window.location.pathname === "/" || window.location.pathname.endsWith("index.html")) {
      window.location.href = "/life.html";
    }
  } else {
    console.log("❌ User not logged in");
  }
}
