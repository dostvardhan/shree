<script>
/**
 * Hard guard for private pages.
 * Waits for auth.init(), then checks session; if not logged in → redirects to Auth0.
 * Also exposes window.authFetch() that auto-attaches the bearer token.
 */
(async () => {
  try {
    const client = await (window.auth?.init?.());
    if (!client) throw new Error("Auth client not available");

    const isAuthed = await client.isAuthenticated();
    if (!isAuthed) {
      await window.auth.login();                    // will redirect to Auth0
      return;
    }

    // helper: fetch with Authorization
    window.authFetch = async (url, options = {}) => {
      const token = await window.auth.getToken();
      const headers = new Headers(options.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...options, headers });
    };
  } catch (err) {
    console.error("Auth guard error:", err);
    // last resort: try to start login
    try { await window.auth?.login?.(); } catch (_) {}
  }
})();
</script>
