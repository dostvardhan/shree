/* auth-init.js - minimal Auth0 SPA init and helper functions.
   EDIT the CLIENT_ID + DOMAIN or ensure env variables are provided
   by your server if you prefer server-side injection.
*/
(function(){
  // configure these values in your real auth-init.js (or keep using Auth0 client id in this file)
  const AUTH0_CLIENT_ID = "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT";
  const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com"; // e.g. dev-xxxx.us.auth0.com
  const AUTH0_AUDIENCE = "https://shree-drive.onrender.com"; // e.g. https://shree-drive.onrender.com

  // load auth0-spa-js dynamically
  const s = document.createElement('script');
  s.src = "https://cdn.auth0.com/js/auth0-spa-js/1.26.0/auth0-spa-js.production.js";
  s.onload = async () => {
    window.__auth0_ready = true;
    window._auth0_client = await createAuth0Client({
      domain: AUTH0_DOMAIN,
      client_id: AUTH0_CLIENT_ID,
      audience: AUTH0_AUDIENCE,
      cacheLocation: "localstorage"
    });

    // helper wrapper
    window.auth = {
      login: async () => {
        await window._auth0_client.loginWithRedirect({redirect_uri: window.location.origin});
      },
      logout: () => window._auth0_client.logout({ returnTo: window.location.origin }),
      getUser: async () => {
        if (!window._auth0_client) return null;
        const isAuth = await window._auth0_client.isAuthenticated();
        if (!isAuth) return null;
        return window._auth0_client.getUser();
      },
      getToken: async () => {
        if (!window._auth0_client) return null;
        return window._auth0_client.getTokenSilently();
      }
    };

    // authFetch that attaches bearer token
    window.authFetch = async (url, opts={}) => {
      const token = await window.auth.getToken();
      opts.headers = opts.headers || {};
      opts.headers["Authorization"] = "Bearer " + token;
      return fetch(url, opts);
    };

    // handle redirect callback if present
    if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
      try { await window._auth0_client.handleRedirectCallback(); }
      catch(e){ console.warn("auth redirect callback error", e); }
      // remove query params
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };
  document.head.appendChild(s);
})();
