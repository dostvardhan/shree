// auth-init.js
// Final shared Auth0 initializer for all pages (non-module loader).
// Place at site root and include in your pages as:
//   <script src="/auth-init.js" defer></script>
//
// Behavior:
// - Dynamically loads the Auth0 UMD SDK (stable CDN UMD build).
// - Waits for createAuth0Client to be available, with timeout and clear errors.
// - Exposes window.__AUTH_READY__ (Promise) that resolves to window.__AUTH__ helper.
// - Exposes window.__AUTH__ with convenience methods: isAuthenticated, login, logout,
//   getUser, getToken, authFetch (adds Authorization header automatically).
//
// IMPORTANT:
// - Ensure Auth0 config values below are correct for your tenant.
// - Do NOT also include another auth0 script tag in pages (avoid double-loading).
// - During testing, bypass Service Worker cache (DevTools → Application → Service Workers → Bypass for network).

(function () {
  if (window.__AUTH_READY__) {
    // already initialized
    return;
  }

  /*************  CONFIG: update only if you rotate client/tenant/audience  *************/
  const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com";
  const AUTH0_CLIENT_ID = "0glcwUr7ZZ9sbBTBPiUPahEqqwUcuzfR";
  // This must match the Auth0 API Identifier you configured (audience)
  const AUTH0_AUDIENCE = "https://shree-drive.onrender.com";

  // Use known stable UMD production bundle that exposes createAuth0Client globally
  const AUTH0_SDK_CDN = "https://cdn.auth0.com/js/auth0-spa-js/1.19.0/auth0-spa-js.production.js";

  // How long to wait (ms) for createAuth0Client to appear after loading the script
  const SDK_WAIT_TIMEOUT_MS = 6000;

  // Expose a promise that resolves when the helper is ready
  window.__AUTH_READY__ = (async function init() {
    // Helper to attempt dynamic import (ESM) fallback (rare)
    async function tryDynamicImport(url) {
      try {
        const m = await import(url);
        return m;
      } catch (e) {
        return null;
      }
    }

    // Ensure createAuth0Client exists as a global; if not, load the UMD script.
    if (typeof createAuth0Client !== "function") {
      // Attempt to load UMD script by injecting a plain non-module script tag.
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = AUTH0_SDK_CDN;
          // Ensure it executes and attaches globals synchronously when appended
          s.async = false;
          s.onload = () => resolve();
          s.onerror = (e) =>
            reject(new Error("Failed to load Auth0 SDK (UMD). " + (e && e.message ? e.message : "")));
          document.head.appendChild(s);

          // Safety timeout — if script loads but does not attach the expected global
          setTimeout(() => {
            if (typeof createAuth0Client === "function") {
              // ok
              return resolve();
            }
            // Try dynamic import fallback (some environments might serve ESM)
            (async () => {
              const m = await tryDynamicImport(AUTH0_SDK_CDN);
              if (m && typeof m.createAuth0Client === "function") {
                // attach to window for compatibility
                window.createAuth0Client = m.createAuth0Client;
                return resolve();
              }
              reject(
                new Error(
                  "Auth0 SDK did not attach expected global (createAuth0Client). " +
                    "Possible SW/caching/CSP or wrong bundle. Try bypassing Service Worker and ensure the UMD build is served."
                )
              );
            })();
          }, SDK_WAIT_TIMEOUT_MS);
        });
      } catch (err) {
        // If UMD load failed, attempt dynamic import once more (helpful for ESM-only hosts)
        try {
          const m = await tryDynamicImport(AUTH0_SDK_CDN);
          if (m && typeof m.createAuth0Client === "function") {
            window.createAuth0Client = m.createAuth0Client;
          } else {
            console.error("Auth0 SDK load failed (both UMD injection and dynamic import):", err);
            throw err;
          }
        } catch (impErr) {
          console.error("Auth0 SDK dynamic import also failed:", impErr);
          throw impErr;
        }
      }
    }

    if (typeof createAuth0Client !== "function") {
      const msg = "Auth0 SDK not available after load. Check Service Worker, CSP, or that the UMD build is served.";
      console.error(msg);
      throw new Error(msg);
    }

    // Now initialize the Auth0 client
    let auth0 = null;
    try {
      auth0 = await createAuth0Client({
        domain: AUTH0_DOMAIN,
        client_id: AUTH0_CLIENT_ID,
        audience: AUTH0_AUDIENCE,
        cacheLocation: "localstorage",
        useRefreshTokens: true,
        // default redirect back to same page so we remain on the page after login
        redirect_uri: window.location.origin + window.location.pathname
      });
    } catch (e) {
      console.error("createAuth0Client initialization error:", e);
      throw e;
    }

    // If coming back from Auth0 redirect (code & state in URL), handle callback
    if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
      try {
        await auth0.handleRedirectCallback();
        // clean URL (remove auth query params)
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        console.warn("Error while handling Auth0 redirect callback:", err);
        // continue — not fatal for initialization
      }
    }

    // Build helper object
    const helper = {
      _auth0: auth0,

      // returns Promise<boolean>
      isAuthenticated: async function () {
        try {
          return await auth0.isAuthenticated();
        } catch (e) {
          console.warn("isAuthenticated check failed:", e);
          return false;
        }
      },

      // loginWithRedirect convenience
      login: function (opts) {
        return auth0.loginWithRedirect(opts || {});
      },

      // logout convenience, returns nothing
      logout: function (opts) {
        return auth0.logout(opts || { returnTo: window.location.origin });
      },

      // get user profile (Promise<object|null>)
      getUser: function () {
        return auth0.getUser();
      },

      // get access token silently (Promise<string>)
      getToken: function (opts) {
        const o = Object.assign({ audience: AUTH0_AUDIENCE }, opts || {});
        return auth0.getTokenSilently(o);
      },

      // authFetch: attaches Authorization header automatically if token available.
      // - url: full URL or relative
      // - opts: fetch options (method, body, headers)
      authFetch: async function (url, opts = {}) {
        try {
          const token = await auth0.getTokenSilently({ audience: AUTH0_AUDIENCE });
          const headers = new Headers(opts.headers || {});
          if (token) headers.set("Authorization", "Bearer " + token);
          // If body is FormData, don't set Content-Type
          const fetchOpts = Object.assign({}, opts, { headers });
          return fetch(url, fetchOpts);
        } catch (err) {
          console.warn("authFetch token error — performing unauthenticated fetch:", err);
          return fetch(url, opts);
        }
      }
    };

    // Attach for compatibility and global access
    window.__AUTH__ = helper;

    // Return the helper so window.__AUTH_READY__ resolves to it.
    return helper;
  })();
})();
