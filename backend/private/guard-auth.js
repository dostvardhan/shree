cd "C:\Users\Dr. Mishra\Documents\shree"

@"
(function () {
  async function checkAuth() {
    try {
      const res = await fetch('/api/me', { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const me = await res.json().catch(()=>({}));
        if (me && me.email) return me;
      }
    } catch(e) {}
    logoutAndRedirect();
    throw new Error('Not authenticated');
  }

  function logoutAndRedirect() {
    try {
      sessionStorage.clear();
      localStorage.removeItem('shree_music_playing');
      localStorage.removeItem('shree_music_volume');
    } catch(e){}
    location.replace('/index.html');
  }

  window.requireAuth = async function(){ return checkAuth(); };
  document.addEventListener('DOMContentLoaded', ()=> { window.requireAuth().catch(()=>{}); });
})();
"@ | Set-Content -Encoding UTF8 "C:\Users\Dr. Mishra\Documents\shree\backend\private\guard-auth.js"
