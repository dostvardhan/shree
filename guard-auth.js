/* guard-auth.js (final) */
(() => {
  const SITE_ORIGIN = 'https://shreshthapushkar.com';
  const BACKEND_ORIGIN = 'https://shree-drive.onrender.com';
  const OPEN_PATHS = new Set(['/login.html', '/login', '/401.html']);

  function isOpenPath(pathname) {
    if (OPEN_PATHS.has(pathname)) return true;
    if (pathname.startsWith('/.netlify/')) return true;
    return false;
  }
  function rememberNext() { try { sessionStorage.setItem('next', location.pathname + location.search); } catch(_){} }
  function consumeNextOrHome() { try {
    const next = sessionStorage.getItem('next') || '/'; sessionStorage.removeItem('next'); return next;
  } catch(_) { return '/'; } }
  function goLogin() { rememberNext(); location.replace('/login.html'); }

  if (!isOpenPath(location.pathname)) {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.netlifyIdentity) return goLogin();
      netlifyIdentity.on('init', (user) => { if (!user) return goLogin(); });
      netlifyIdentity.on('logout', () => goLogin());
      netlifyIdentity.on('login', () => { const dest = consumeNextOrHome(); if (location.pathname !== dest) location.replace(dest); });
      netlifyIdentity.init();
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.netlifyIdentity) return;
      netlifyIdentity.on('init', (user) => {
        if (user) {
          const dest = consumeNextOrHome();
          if (location.pathname !== dest) location.replace(dest);
        }
      });
      netlifyIdentity.init();
    });
  }

  // authFetch with one automatic retry on 401
  async function authFetch(url, options = {}) {
    const ni = window.netlifyIdentity;
    if (!ni) { goLogin(); throw new Error('Netlify Identity not available'); }
    const getJwt = async () => {
      const u = ni.currentUser();
      if (!u) { goLogin(); throw new Error('Not authenticated'); }
      const t = await u.jwt();
      if (!t || t.length < 100) throw new Error('Invalid Identity token');
      return t;
    };
    const send = async (token) => {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      const fetchOpts = { ...options, headers, credentials: 'omit', mode: 'cors' };
      return fetch(url, fetchOpts);
    };
    let token = await getJwt();
    let res = await send(token);
    if (res.status === 401) { // retry once with fresh jwt
      try { token = await getJwt(); res = await send(token); } catch (_) {}
    }
    return res;
  }

  window.__AUTH__ = { authFetch, BACKEND_ORIGIN, SITE_ORIGIN };
})();
