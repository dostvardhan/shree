// backend/private/guard-auth.js
(() => {
  // wait for Auth0 client
  function waitForAuth0(maxMs = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      (function check() {
        if (window.auth0) return resolve(window.auth0);
        if (Date.now() - start > maxMs) return reject(new Error("auth0 not ready"));
        setTimeout(check, 50);
      })();
    });
  }

  // Global: requireAuth used by pages
  window.requireAuth = async function requireAuth() {
    const auth0 = await waitForAuth0().catch(() => null);
    if (!auth0) {
      // fallback: if auth not ready, push to index
      location.href = "/index.html";
      throw new Error("Auth client not ready");
    }
    const isAuth = await auth0.isAuthenticated().catch(() => false);
    if (!isAuth) {
      // redirect back to current page after login
      await auth0.loginWithRedirect({
        authorizationParams: { redirect_uri: window.location.href }
      });
      return false;
    }
    return true;
  };

  // Global: logout used everywhere
  window.logout = async function logout() {
    try {
      const auth0 = await waitForAuth0().catch(() => null);
      if (auth0) {
        auth0.logout({ logoutParams: { returnTo: location.origin + "/index.html" } });
      } else {
        location.href = "/index.html";
      }
    } catch {
      location.href = "/index.html";
    }
  };

  // Intercept any <a href="logout.html"> clicks on ANY page
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href="logout.html"], a[href="/logout.html"]');
    if (!a) return;
    e.preventDefault();
    window.logout();
  });
})();
