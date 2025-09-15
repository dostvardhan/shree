/* guard-auth.js - hides protected elements until auth status known.
   It expects auth-init.js to define window.auth.getUser() and window.auth.login()
*/
(function(){
  const protectedSelector = "[data-guard]";
  async function initGuard(){
    // wait for auth-init to boot
    let tries = 0;
    while (!window.auth && tries < 40) { await new Promise(r=>setTimeout(r,150)); tries++; }
    const protectedEls = document.querySelectorAll(protectedSelector);
    if (!window.auth) {
      // show login prompt in each guarded element
      protectedEls.forEach(el => {
        el.style.display = "block";
        const html = '<div style="padding:18px"><strong>Login required</strong><div style="margin-top:8px"><button id="guardLoginBtn">Login</button></div></div>';
        el.innerHTML = html;
        const btn = document.getElementById("guardLoginBtn");
        if (btn) btn.addEventListener("click", ()=> window.auth && window.auth.login && window.auth.login());
      });
      return;
    }

    const user = await window.auth.getUser();
    if (!user) {
      // not logged in — show login button
      protectedEls.forEach(el => {
        el.style.display = "block";
        const btn = document.createElement("button");
        btn.innerText = "Login to continue";
        btn.addEventListener("click", ()=> window.auth.login());
        el.prepend(btn);
      });
      return;
    }

    // logged in — reveal content (do nothing if content already present)
    protectedEls.forEach(el => { el.style.display = ""; });
  }
  // run
  initGuard().catch(e=>console.warn("guard error", e));
})();
