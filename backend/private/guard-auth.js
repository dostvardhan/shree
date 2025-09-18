let auth0Client = null;

async function guardAuth() {
  auth0Client = await createAuth0Client({
    domain: "dev-zzhjbmtzoxtgoz31.us.auth0.com",
    client_id: "6sfOCkf0BFVHsuzfPJCHoLDffZSNJjzT",
    audience: "https://shree-drive.onrender.com",
    cacheLocation: "localstorage",
    useRefreshTokens: true
  });

  const isAuthenticated = await auth0Client.isAuthenticated();

  if (!isAuthenticated) {
    await auth0Client.loginWithRedirect({
      redirect_uri: window.location.origin + "/index.html"
    });
    return;
  }

  // Attach token to window for API requests
  const token = await auth0Client.getTokenSilently();
  window.authFetch = async (url, options = {}) => {
    options.headers = options.headers || {};
    options.headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, options);
  };
}

window.onload = guardAuth;
