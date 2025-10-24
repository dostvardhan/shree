(function(){
  function bounce(){
    try{
      sessionStorage.removeItem('shree_id_token');
      localStorage.removeItem('shree_music_playing');
      localStorage.removeItem('shree_music_volume');
    }catch(e){}
    if(location.pathname !== '/index.html'){
      location.replace('/index.html');
    }
  }

  window.requireAuth = async function requireAuth(){
    try{
      const r = await fetch('/api/me',{credentials:'include',cache:'no-store'});
      if(r.ok){
        const me = await r.json().catch(()=>({}));
        if(me && me.email) return me;
      }
      bounce();
      throw new Error('Not authenticated');
    }catch(e){
      bounce();
      throw e;
    }
  };

  document.addEventListener('DOMContentLoaded',()=>{
    if(typeof window.requireAuth === 'function'){
      window.requireAuth().catch(()=>{});
    }
  });
})();
