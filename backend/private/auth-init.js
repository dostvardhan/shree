<!-- keep this script BEFORE guard-auth.js on every page -->
<script src="/auth0-spa-js.production.js"></script>
<script>
(() => {
  // Private scope — nothing leaks except window.auth
  const AUDIENCE =
    (location.hostname === "shreshthapushkar.com")
      ? "https://shreshthapushkar.com"
      : "https://shree-drive.onrender.com";

  const REDIRECT_URI = `${location.origin}/auth/callback`;

  let _client;                 // the Auth0 client
  let _initPromise = null;     // one-time initializer

  async function initOnce() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
      _client = await createAuth0Client({
        domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
        client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
        audience: AUDIENCE,
        cacheLocation: "localstorage",
        useRefreshTokens: true,
      });

      // handle the Auth0 redirect callback (if any)
      if (location.search.includes("code=") && location.search.includes("state=")) {
        try {
          await _client.handleRedirectCallback();
        } catch (e) {
          console.error("Auth0 callback error:", e);
        } finally {
          history.replaceState({}, document.title, "/life.html");
        }
      }

      return _client;
    })();

    return _initPromise;
  }

  // Tiny public API under a single global
  window.auth = {
    init: initOnce,                                // await auth.init()
    getClient: async () => await initOnce(),       // returns the Auth0 client
    getToken: async () => (await initOnce()).getTokenSilently(),
    login: async () => (await initOnce()).loginWithRedirect({ redirect_uri: REDIRECT_URI }),
    logout: async () => (await initOnce()).logout({
      logoutParams: { returnTo: location.origin },
    }),
  };

  // Kick off initialization immediately (but pages can still await auth.init())
  initOnce();
})();
</script>
