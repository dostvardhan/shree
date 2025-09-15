// auth-init.js
// place at repo root, included by pages in <head>
(function () {
  const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com"; // replace if needed
  const AUTH0_CLIENT_ID = "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT"; // replace if needed
  const AUTH0_AUDIENCE = "https://shree-drive.onrender.com"; // must match your API audience

  // load auth0-spa-js
  const s = document.createElement("script");
  s.src = "https://cdn.auth0.com/js/auth0-spa-js/1.26.0/auth0-spa-js.production.js";
  s.onload = async () => {
    try {
      window._auth0_client = await createAuth0Client({
        domain: AUTH0_DOMAIN,
        client_id: AUTH0_CLIENT_ID,
        audience: AUTH0_AUDIENCE,
        cacheLocation: "localstorage",
        useRefreshTokens: true
      });

      // public helper API
      window.auth = {
        login: (opts = {}) => window._auth0_client.loginWithRedirect(opts),
        logout: (opts = {}) => window._auth0_client.logout(Object.assign({ returnTo: window.location.origin }, opts)),
        getUser: async () => {
          if (!window._auth0_client) return null;
          const isAuth = await window._auth0_client.isAuthenticated();
          return isAuth ? await window._auth0_client.getUser() : null;
        },
        getToken: async () => {
          if (!window._auth0_client) return null;
          return await window._auth0_client.getTokenSilently();
        }
      };

      // handle redirect callback (if any)
      if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
        try {
          await window._auth0_client.handleRedirectCallback();
        } catch (e) {
          console.warn("Auth redirect callback error:", e);
        }
        // remove query params
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, clean);
      }
    } catch (err) {
      console.error("auth-init failed:", err);
    }
  };
  document.head.appendChild(s);
})();
