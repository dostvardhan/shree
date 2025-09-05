(() => {
  // CONFIG - update if you want to override
  const AUTH0_DOMAIN = 'dev-zzhjbmtzoxtgoz31.us.auth0.com';
  const AUTH0_CLIENT_ID = '0glcwUr7ZZ9sbBTBPiUPahEqqwUcuzfR';
  const AUTH0_AUDIENCE = 'https://shree-drive.onrender.com'; // must match Auth0 API identifier

  const OPEN_PATHS = new Set(['/login.html', '/login', '/401.html', '/', '/index.html']);
  const OPEN_PREFIX = '/.netlify/';

  let auth0ClientPromise = null;
  let auth0ClientInstance = null;

  function initAuth0Client() {
    if (auth0ClientPromise) return auth0ClientPromise;
    auth0ClientPromise = (async () => {
      if (typeof createAuth0Client !== 'function') {
        console.error('Auth0 SDK missing: include auth0-spa-js first.');
        throw new Error('Auth0 SDK missing');
      }
      auth0ClientInstance = await createAuth0Client({
        domain: AUTH0_DOMAIN,
        client_id: AUTH0_CLIENT_ID,
        authorizationParams: {
          audience: AUTH0_AUDIENCE,
          redirect_uri: window.location.origin + window.location.pathname
        },
        cacheLocation: 'localstorage',
        useRefreshTokens: true
      });
      if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
        try {
          await auth0ClientInstance.handleRedirectCallback();
          const next = sessionStorage.getItem('next') || '/';
          sessionStorage.removeItem('next');
          window.history.replaceState({}, document.title, window.location.pathname);
          if (location.pathname !== next) location.replace(next);
        } catch (e) {
          console.warn('Redirect handling failed', e);
        }
      }
      return auth0ClientInstance;
    })();
    return auth0ClientPromise;
  }

  function isOpenPath(pathname) {
    if (OPEN_PATHS.has(pathname)) return true;
    if (pathname.startsWith(OPEN_PREFIX)) return true;
    return false;
  }

  function rememberNext() {
    try { sessionStorage.setItem('next', location.pathname + location.search); } catch(_) {}
  }
  function consumeNextOrHome() {
    try {
      const next = sessionStorage.getItem('next') || '/';
      sessionStorage.removeItem('next');
      return next;
    } catch(_) { return '/'; }
  }

  async function loginRedirect(returnTo) {
    await initAuth0Client();
    try {
      await auth0ClientInstance.loginWithRedirect({ authorizationParams: { redirect_uri: window.location.origin + window.location.pathname }, appState: { returnTo }});
    } catch (e) { console.error('loginWithRedirect failed', e); }
  }

  async function logout() {
    await initAuth0Client();
    try {
      await auth0ClientInstance.logout({ logoutParams: { returnTo: window.location.origin }});
    } catch (e) { console.error('logout failed', e); }
  }

  async function authFetch(url, options = {}) {
    await initAuth0Client();
    const getToken = async (opts = {}) => {
      const isAuth = await auth0ClientInstance.isAuthenticated();
      if (!isAuth) {
        rememberNext();
        await loginRedirect(location.pathname + location.search);
        throw new Error('Not authenticated');
      }
      return auth0ClientInstance.getTokenSilently(opts);
    };

    const send = async (token) => {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      const fetchOpts = { ...options, headers, credentials: 'omit', mode: 'cors' };
      return fetch(url, fetchOpts);
    };

    let token = await getToken();
    let res = await send(token);
    if (res.status === 401) {
      try {
        token = await getToken({ ignoreCache: true });
        res = await send(token);
      } catch (_) {}
    }
    return res;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await initAuth0Client();
    } catch (e) {
      console.error('Auth0 init failed', e);
      return;
    }

    if (!isOpenPath(location.pathname)) {
      const isAuth = await auth0ClientInstance.isAuthenticated();
      if (!isAuth) {
        rememberNext();
        await loginRedirect(location.pathname + location.search);
      }
    } else {
      const isAuth = await auth0ClientInstance.isAuthenticated();
      if (isAuth) {
        const dest = consumeNextOrHome();
        if (location.pathname !== dest) location.replace(dest);
      }
    }
  });

  window.__AUTH__ = {
    init: initAuth0Client,
    authFetch,
    login: () => { rememberNext(); loginRedirect(location.pathname + location.search); },
    logout,
    getClient: async () => { await initAuth0Client(); return auth0ClientInstance; },
    audience: AUTH0_AUDIENCE,
    domain: AUTH0_DOMAIN,
  };
})();
