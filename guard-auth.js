/* guard-auth.js — Auth0 version (replace your Netlify guard) */
(() => {
  // CONFIG — change if you prefer to inject these from a global <script> or build step
  const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com"; // replace with your Auth0 domain
  const AUTH0_CLIENT_ID = "0glcwUr7ZZ9sbBTBPiUPahEqqwUcuzfR"; // replace with your Auth0 client id
  const AUTH0_AUDIENCE = "https://shree-drive.onrender.com"; // backend audience (optional)
  const SITE_ORIGIN = window.location.origin;
  const BACKEND_ORIGIN = "https://shree-drive.onrender.com";

  // paths which don't need auth
  const OPEN_PATHS = new Set(['/login.html', '/401.html', '/']);

  function isOpenPath(pathname) {
    if (OPEN_PATHS.has(pathname)) return true;
    // static assets & public health endpoints
    if (pathname.startsWith('/static/') || pathname.startsWith('/assets/')) return true;
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

  // initialise Auth0 client once
  let auth0Client = null;
  async function initAuth0() {
    if (auth0Client) return auth0Client;
    if (typeof createAuth0Client !== 'function') {
      console.error('Auth0 SDK missing (createAuth0Client). Make sure auth0-spa-js is loaded.');
      return null;
    }
    auth0Client = await createAuth0Client({
      domain: AUTH0_DOMAIN,
      client_id: AUTH0_CLIENT_ID,
      authorizationParams: {
        audience: AUTH0_AUDIENCE,
        redirect_uri: window.location.origin + window.location.pathname
      }
    });
    // handle redirect callback if present
    if (window.location.search.includes('code=') || window.location.search.includes('state=')) {
      try {
        await auth0Client.handleRedirectCallback();
        // remove query params
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (e) {
        console.error('Auth0 handleRedirectCallback failed', e);
      }
    }
    return auth0Client;
  }

  // If path is protected, enforce login on DOMContentLoaded
  if (!isOpenPath(location.pathname)) {
    document.addEventListener('DOMContentLoaded', async () => {
      const client = await initAuth0();
      if (!client) {
        // fallback: redirect to login page (local)
        rememberNext();
        return location.replace('/login.html');
      }
      const isAuthenticated = await client.isAuthenticated();
      if (!isAuthenticated) {
        // start redirect login
        rememberNext();
        await client.loginWithRedirect();
        // after redirect, execution won't continue here — the callback handler will restore next
      } else {
        // logged in: continue
        const dest = consumeNextOrHome();
        if (location.pathname !== dest) location.replace(dest);
      }
    });
  } else {
    // On open paths, init and, if already logged in, redirect to next
    document.addEventListener('DOMContentLoaded', async () => {
      const client = await initAuth0().catch(()=>null);
      if (!client) return;
      const isAuthenticated = await client.isAuthenticated();
      if (isAuthenticated) {
        const dest = consumeNextOrHome();
        if (location.pathname !== dest) location.replace(dest);
      }
    });
  }

  // authFetch using Auth0 token + one retry on 401
  async function authFetch(url, options = {}) {
    const client = await initAuth0();
    if (!client) { rememberNext(); throw new Error('Auth0 client not available'); }

    // get token (silently) — will try existing session / refresh
    async function getToken() {
      try {
        return await client.getTokenSilently();
      } catch (err) {
        // fallback: interactive redirect
        rememberNext();
        await client.loginWithRedirect();
        throw new Error('Redirecting to login');
      }
    }

    const send = async (token) => {
      const headers = new Headers(options.headers || {});
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const fetchOpts = { ...options, headers, credentials: 'omit', mode: 'cors' };
      return fetch(url, fetchOpts);
    };

    let token = await getToken();
    let res = await send(token);
    if (res.status === 401) {
      // try once more with fresh token
      try {
        token = await getToken();
        res = await send(token);
      } catch (_) {}
    }
    return res;
  }

  // expose small public API
  window.__AUTH__ = { initAuth0, authFetch, BACKEND_ORIGIN, SITE_ORIGIN, AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE };
})();
