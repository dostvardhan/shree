// guard-auth.js
// Include in <head> of protected pages AFTER auth-init.js:
// <script src="/auth0-spa-js.production.js"></script>
// <script src="/auth-init.js"></script>
// <script src="/guard-auth.js"></script>

(function(){
  // hide page until auth check completes
  document.documentElement.style.visibility = 'hidden';

  function whenReady(fn){
    if(window.initAuth0) return fn();
    var i = 0;
    var t = setInterval(function(){
      if(window.initAuth0){ clearInterval(t); fn(); }
      if(++i > 60){ clearInterval(t); console.warn('auth-init not found'); document.documentElement.style.visibility = 'visible'; }
    }, 50);
  }

  whenReady(async function(){
    try {
      await window.initAuth0();
      const authed = await window.isAuthenticated();
      if(!authed){
        // not logged in -> redirect to index page (login)
        window.location.replace('/index.html');
        return;
      }
    } catch(err){
      console.error('guard-auth error', err);
      // redirect to login on error for safety
      window.location.replace('/index.html');
      return;
    } finally {
      document.documentElement.style.visibility = 'visible';
    }
  });
})();
