// Very small client helper used on index.html.
// It doesn't perform login (server handles Auth0 redirect at /auth/login).
// It simply optionally shows login status by calling /api/diag.

async function checkAuthStatus() {
  try {
    const resp = await fetch('/api/diag', { credentials: 'include' });
    if (resp.ok) {
      // logged in
      return await resp.json();
    }
    return null;
  } catch (e) {
    return null;
  }
}

// expose for debugging
window.checkAuthStatus = checkAuthStatus;
