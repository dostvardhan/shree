// guard-auth.js (Auth0 guard — include as <script src="/guard-auth.js" type="module"></script>)
import createAuth0Client from '/auth0-spa-js.production.js';

const AUTH0_DOMAIN = "dev-zzhjbmtzoxtgoz31.us.auth0.com"; // replace with your domain if different
const AUTH0_CLIENT_ID = "0glcwUr7ZZ9sbBTBPiUPahEqqwUcuzfR";
const AUTH0_AUDIENCE = "https://shree-drive.onrender.com";

(async function() {
  try {
    const auth0 = await createAuth0Client({
      domain: AUTH0_DOMAIN,
      client_id: AUTH0_CLIENT_ID,
      authorizationParams: {
        audience: AUTH0_AUDIENCE,
        redirect_uri: window.location.origin + window.location.pathname
      }
    });

    if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
      await auth0.handleRedirectCallback();
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const isAuth = await auth0.isAuthenticated();
    if (!isAuth) {
      try { sessionStorage.setItem('next', location.pathname + location.search); } catch(_) {}
      await auth0.loginWithRedirect();
    } else {
      window.__AUTH0_CLIENT__ = auth0;
    }
  } catch (e) {
    console.error("Auth guard error:", e);
    try { sessionStorage.setItem('next', location.pathname + location.search); } catch(_) {}
    window.location.replace('/login.html');
  }
})();
