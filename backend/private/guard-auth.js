// Soft server-side check: if no session/cookie, bounce to login
(async () => {
  try {
    const res = await fetch("/api/diag", { credentials: "include" });
    if (!res.ok) throw new Error("not authed");
  } catch {
    location.href = "/auth/login";
  }
})();

// Helper for calling protected APIs
async function authFetch(url, opts = {}) {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (r.status === 401) {
    location.href = "/auth/login";
    return new Response(null, { status: 401 });
  }
  return r;
}
window.authFetch = authFetch;

