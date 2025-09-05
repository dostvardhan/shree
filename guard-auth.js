/* guard-auth.js (Auth0 version) */
/*
  - Replace AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE with your Auth0 values.
  - Ensure auth0-spa-js (createAuth0Client) is available on pages that include this file:
      <script src="/auth0-spa-js.production.js"></script>
*/

(() => {
  // === CONFIG — replace these with your values ===
  const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com"; // example — set your domain
  const AUTH0_CLIENT_ID = "0glcwUr7ZZ9sbBTBPiUPahEqqwUcuzfR"; // set your client id
  const AUTH0_AUDIENCE = "https://shree-drive.onrender.com"; // set your audience (backend)
  // ===============================================

  const SITE_ORIGIN = window.location.origin;
  const OPEN_PATHS = new Set(['/login.html', '/login', '/401.html', '/', '/index.html']);

  function isOpenPath(pathname) {
    if (OPEN_PATHS.has(pathname)) return true;
    // allow static asset/ajax paths if needed
    if (pathname.startsWith('/static/') || pathname.startsWith('/assets/')) return true;
    return false;
  }

  function rememberNext() {
    try { sessionStorage.setItem('next', location.pathname + location.search); } catch (_) {}
  }
  function consumeNextOrHome() {
    try {
      const next = sessionStorage.getItem('next') || '/';
      sessionStorage.removeItem('next');
      return next;
    } catch (_) { return '/'; }
  }
  function goLogin() {
    rememberNext();
    // redirect to a dedicated login page that will call auth0 loginWithRedirect()
    // We assume you have /login.html that triggers redirect; otherwise go direct to root and let page JS handle it.
    location.replace('/login.html');
  }

  // Auth0 client (singleton)
  let auth0Client = null;
  let auth0InitPromise = null;

  async function initAuth0() {
    if (auth0InitPromise) return auth0InitPromise;
    auth0InitPromise = (async () => {
      if (typeof createAuth0Client !== 'function') {
        console.error('Auth0 SDK is missing. Add <script src="/auth0-spa-js.production.js"></script>');
        return null;
      }
      try {
        auth0Client = await createAuth0Client({
          domain: AUTH0_DOMAIN,
          client_id: AUTH0_CLIENT_ID,
          authorizationParams: {
            audience: AUTH0_AUDIENCE,
            redirect_uri: window.location.origin + window.location.pathname // remove query
          },
          cacheLocation: 'localstorage' // optional: helps token persistence (choose as you prefer)
        });

        // If redirected back from Auth0 (code= in URL), process it
        if (window.location.search.includes('code=') || window.location.search.includes('state=')) {
          try {
            await auth0Client.handleRedirectCallback();
            // Remove query params without reloading
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch (err) {
            console.warn('Auth0 handleRedirectCallback error', err);
          }
        }

        // return client
        return auth0Client;
      } catch (err) {
        console.error('Failed to init Auth0', err);
        return null;
      }
    })();
    return auth0InitPromise;
  }

  // If this page is protected, check login on DOMContentLoaded (guard)
  if (!isOpenPath(location.pathname)) {
    document.addEventListener('DOMContentLoaded', async () => {
      await initAuth0();
      if (!auth0Client) return goLogin();

      const isAuthenticated = await auth0Client.isAuthenticated();
      if (!isAuthenticated) {
        // not logged in → go to login
        return goLogin();
      }
      // logged in -> nothing to do (page continues)
    });
  } else {
    // On open paths, if user already logged in, redirect to next (consume)
    document.addEventListener('DOMContentLoaded', async () => {
      await initAuth0();
      if (!auth0Client) return;
      const isAuthenticated = await auth0Client.isAuthenticated();
      if (isAuthenticated) {
        const dest = consumeNextOrHome();
        if (location.pathname + location.search !== dest) location.replace(dest);
      }
    });
  }

  // --- authFetch: automatically attach Authorization header with Bearer token.
  // It retries once if the response is 401 (refresh token/getTokenSilently retry).
  async function authFetch(url, options = {}) {
    const client = await initAuth0();
    if (!client) { goLogin(); throw new Error('Auth0 not initialized'); }

    const getToken = async () => {
      const isAuth = await client.isAuthenticated();
      if (!isAuth) { goLogin(); throw new Error('Not authenticated'); }
      // try to get token silently (will use refresh token or iframe)
      const token = await client.getTokenSilently().catch(async (err) => {
        // as fallback, force interactive login
        console.warn('getTokenSilently failed, triggering loginWithRedirect', err);
        rememberNext();
        await client.loginWithRedirect();
        throw err;
      });
      if (!token || typeof token !== 'string' || token.length < 20) throw new Error('Invalid token');
      return token;
    };

    const send = async (token) => {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      const fetchOpts = { ...options, headers, credentials: options.credentials ?? 'omit', mode: options.mode ?? 'cors' };
      return fetch(url, fetchOpts);
    };

    let token = await getToken();
    let res = await send(token);

    if (res.status === 401) {
      // try once more (token might be stale)
      try {
        token = await getToken();
        res = await send(token);
      } catch (e) {
        // fall through returning original 401
      }
    }

    return res;
  }

  // expose to window for pages to use
  window.__AUTH__ = {
    initAuth0,
    authFetch,
    getAuth0Client: async () => {
      await initAuth0();
      return auth0Client;
    },
    LOGIN: async (opts = {}) => {
      await initAuth0();
      rememberNext();
      return auth0Client.loginWithRedirect(opts);
    },
    LOGOUT: async (opts = {}) => {
      await initAuth0();
      return auth0Client.logout({ logoutParams: { returnTo: opts.returnTo || SITE_ORIGIN } });
    },
    BACKEND_AUDIENCE: AUTH0_AUDIENCE
  };
})();
