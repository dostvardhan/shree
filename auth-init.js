// auth-init.js
// Shared Auth0 initializer for all pages
// Drop this file in your static root and include <script src="/auth-init.js" defer></script>
// Config - change here only if you ever rotate Auth0 client/tenant/audience
const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com";
const AUTH0_CLIENT_ID = "0glcwUr7ZZ9sbBTBPiUPahEqqwUcuzfR";
const AUTH0_AUDIENCE = "https://shree-drive.onrender.com";
const AUTH0_SDK_CDN = "https://cdn.auth0.com/js/auth0-spa-js/1.19/auth0-spa-js.production.js";

(function () {
  // Expose a promise that resolves when auth is ready
  if (window.__AUTH_READY__) return; // don't re-init if already done

  window.__AUTH_READY__ = (async function init() {
    // Load Auth0 SDK if not present
    if (typeof createAuth0Client !== "function") {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = AUTH0_SDK_CDN;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = (e) => reject(new Error("Failed to load Auth0 SDK"));
        document.head.appendChild(s);
      });
    }

    if (typeof createAuth0Client !== "function") {
      console.error("Auth0 SDK not available after load.");
      throw new Error("Auth0 SDK failed to load");
    }

    // Initialize Auth0 client
    const auth0 = await createAuth0Client({
      domain: AUTH0_DOMAIN,
      client_id: AUTH0_CLIENT_ID,
      audience: AUTH0_AUDIENCE,
      cacheLocation: "localstorage",
      useRefreshTokens: true,
      // default redirect back to same page so we remain on the page after login
      redirect_uri: window.location.origin + window.location.pathname
    });

    // If the URL contains a callback from Auth0, handle it now:
    if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
      try {
        await auth0.handleRedirectCallback();
        // remove auth query params without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        console.error("Error handling Auth0 redirect callback:", err);
      }
    }

    // wrapper helper
    const helper = {
      _auth0: auth0,
      isAuthenticated: () => auth0.isAuthenticated(),
      login: (opts) => auth0.loginWithRedirect(opts || {}),
      logout: (opts) => auth0.logout(opts || { returnTo: window.location.origin }),
      getUser: () => auth0.getUser(),
      getToken: (opts) => auth0.getTokenSilently(opts || { audience: AUTH0_AUDIENCE }),
      // authFetch: attaches Authorization header with access token for backend calls
      authFetch: async function (url, opts = {}) {
        try {
          const token = await auth0.getTokenSilently({ audience: AUTH0_AUDIENCE });
          const headers = new Headers(opts.headers || {});
          if (token) headers.set("Authorization", "Bearer " + token);
          return fetch(url, { ...opts, headers });
        } catch (err) {
          console.warn("authFetch token error — falling back to fetch:", err);
          return fetch(url, opts);
        }
      }
    };

    // attach for debug/quick access
    window.__AUTH__ = helper;
    return helper;
  })();
})();
