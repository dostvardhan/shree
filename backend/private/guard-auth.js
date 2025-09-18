// guard-auth.js
// include in <head>, wrap content in <div data-guard>...</div>
(function () {
  const GUARD_ATTR = "data-guard";

  function hideGuards() {
    document.querySelectorAll("[" + GUARD_ATTR + "]").forEach(el => {
      el.dataset._savedDisplay = el.style.display || "";
      el.style.display = "none";
    });
  }
  function showGuards() {
    document.querySelectorAll("[" + GUARD_ATTR + "]").forEach(el => {
      el.style.display = el.dataset._savedDisplay || "";
    });
  }

  hideGuards();

  async function initGuard() {
    // wait for auth to initialize
    let tries = 0;
    while (!window.auth && tries < 60) { await new Promise(r => setTimeout(r, 100)); tries++; }
    if (!window.auth || !window.auth.getUser) {
      // if auth not available, redirect to login page
      console.warn("guard: auth not loaded");
      window.location.href = "/";
      return;
    }

    try {
      const user = await window.auth.getUser();
      if (!user) {
        // not logged in -> redirect to login page (index)
        // but keep a small UI first: show login button inside first guard section
        const guards = document.querySelectorAll("[" + GUARD_ATTR + "]");
        guards.forEach(g => {
          g.innerHTML = '<div style="padding:28px;text-align:center"><h3>Login required</h3><p><button id="guardLogin">Login</button></p></div>';
        });
        const b = document.getElementById("guardLogin");
        if (b) b.addEventListener("click", () => window.auth.login({ redirect_uri: window.location.origin + "/life.html" }));
        return;
      }
      // logged in — reveal
      showGuards();
    } catch (err) {
      console.warn("guard: error checking auth", err);
      window.location.href = "/";
    }
  }

  initGuard();
})();
