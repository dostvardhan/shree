// Hard guard for any page that includes this file
(async () => {
  // Wait until auth client is ready
  await window.authReady;
  const client = window.auth0Client();

  // If not authenticated -> redirect to login
  const isAuth = await client.isAuthenticated();
  if (!isAuth) {
    await client.loginWithRedirect({ redirect_uri: window.REDIRECT_URI });
    return;
  }

  // Authenticated: create a helper fetch that auto-adds bearer token
  window.authFetch = async (url, opts = {}) => {
    const token = await client.getTokenSilently();
    const headers = new Headers(opts.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...opts, headers });
  };
})();
