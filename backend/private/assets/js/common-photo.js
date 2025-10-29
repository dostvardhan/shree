// common-photo.js (updated: full-image, smaller colorful hearts, caption placement)
(function(){
  /* ---------- tiny helper ---------- */
  function $id(id){ return document.getElementById(id); }
  function safe(fn){ try{ fn(); }catch(e){ console.warn("common-photo:", e && e.message); } }

  /* ---------- LOGOUT (robust) ---------- */
  safe(function(){
    const logout = $id('logoutBtn');
    if(logout){
      logout.addEventListener('click', function(e){
        e.preventDefault();
        fetch('/auth/logout', { method:'GET', credentials:'include' })
          .catch(()=>{})
          .finally(()=> { location.href = '/index.html'; });
      }, { passive:true });
    }
  });

  /* ---------- HERO PHOTO: show full image (no crop) & center ---------- */
  safe(function(){
    const hero = $id('heroImg');
    if(hero){
      // Uncropped full view: use contain and let the container control max size
      hero.style.display = 'block';
      hero.style.margin = '0 auto';
      hero.style.width = 'min(1100px, 86vw)';
      hero.style.maxHeight = '86vh';
      hero.style.objectFit = 'contain';      // <-- key change: contain (no crop)
      hero.style.cursor = 'zoom-in';
      hero.style.borderRadius = '10px';
      hero.style.boxShadow = '0 26px 70px rgba(0,0,0,0.16)';
      // caption placement: look for .caption (works on all pages)
      const cap = document.querySelector('.caption') || document.querySelector('.cap');
      if(cap){
        cap.style.display = 'inline-block';
        cap.style.margin = '12px auto 4px';
        cap.style.padding = '8px 14px';
        cap.style.borderRadius = '999px';
        cap.style.background = 'rgba(255,255,255,0.92)';
        cap.style.color = 'rgba(90,52,70,0.95)';
        cap.style.fontStyle = 'italic';
        cap.style.fontSize = '14px';
        cap.style.textAlign = 'center';
      }
      // ensure wrapper is roomy so image doesn't get forced small
      const main = document.querySelector('main') || document.body;
      main.style.maxWidth = main.style.maxWidth || '1200px';
      main.style.margin = main.style.margin || '26px auto';
      main.style.padding = main.style.padding || '0 18px 86px';
    }
  });

  /* ---------- LIGHTBOX (extra-large on click) ---------- */
  safe(function(){
    const hero = $id('heroImg');
    if(!hero) return;
    hero.addEventListener('click', function(){
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(0,0,0,0.92)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = 99999;

      const img = document.createElement('img');
      img.src = hero.src;
      img.style.maxWidth = '98vw';
      img.style.maxHeight = '96vh';
      img.style.objectFit = 'contain';
      img.style.borderRadius = '10px';
      img.style.boxShadow = '0 40px 120px rgba(0,0,0,.7)';
      overlay.appendChild(img);

      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.style.position = 'absolute';
      btn.style.top = '18px';
      btn.style.right = '18px';
      btn.style.background = 'transparent';
      btn.style.color = '#fff';
      btn.style.fontSize = '22px';
      btn.style.border = 'none';
      btn.style.cursor = 'pointer';
      overlay.appendChild(btn);

      btn.addEventListener('click', () => overlay.remove(), { passive:true });
      overlay.addEventListener('click', (ev) => { if(ev.target === overlay) overlay.remove(); }, { passive:true });

      document.body.appendChild(overlay);
    }, { passive:true });
  });

  /* ---------- MUSIC + VOLUME (keeps previous UI) ---------- */
  safe(function(){
    const audio = $id('bgMusic');
    const playBtn = $id('musicBtn');
    const volRange = $id('volRange');

    // create hidden audio if missing (prevents other errors)
    if(!audio){
      const a = document.createElement('audio');
      a.id = 'bgMusic'; a.loop = true;
      document.body.appendChild(a);
    }
    const A = $id('bgMusic');
    if(!A) return;

    // volume restore
    const vol = parseFloat(localStorage.getItem('shree_vol') || '0.80');
    A.volume = isNaN(vol) ? 0.8 : vol;
    if(volRange) volRange.value = Math.round(A.volume * 100);
    const playPref = localStorage.getItem('shree_play') === 'true';
    if(playPref) A.play().catch(()=>{});

    if(playBtn){
      playBtn.addEventListener('click', function(){
        if(A.paused){ A.play().catch(()=>{}); localStorage.setItem('shree_play','true'); }
        else { A.pause(); localStorage.setItem('shree_play','false'); }
      }, { passive:true });
    }

    if(volRange){
      volRange.addEventListener('input', function(){
        A.volume = (Number(volRange.value) || 0) / 100;
        localStorage.setItem('shree_vol', String(A.volume));
      }, { passive:true });
    }
  });

  /* ---------- SMALL COLORFUL HEARTS (smaller + pastel palette) ---------- */
  safe(function(){
    let canvas = $id('heartsCanvas');
    if(!canvas){
      canvas = document.createElement('canvas');
      canvas.id = 'heartsCanvas';
      canvas.style.position = 'fixed';
      canvas.style.inset = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '2';
      document.body.appendChild(canvas);
    }
    const ctx = canvas.getContext('2d');
    let W = innerWidth, H = innerHeight;
    function resize(){ W = innerWidth; H = innerHeight; canvas.width = W; canvas.height = H; }
    resize(); addEventListener('resize', resize);

    // pastel palette
    const colors = ['#f6c1d9','#ffd8b3','#fbe6a6','#c7f0d1','#cfe6ff','#e7c9ff','#ffccd6'];
    const hearts = [];

    function spawn(){
      return {
        x: Math.random() * W,
        y: H + 6,
        s: 6 + Math.random() * 12,       // smaller sizes (6-18)
        vy: -0.6 - Math.random()*1.2,
        a: 0.8 + Math.random()*0.6,
        col: colors[Math.floor(Math.random()*colors.length)],
        rot: (Math.random()-0.5) * 0.6
      };
    }

    function drawHeart(x,y,s,color,alpha){
      ctx.save();
      ctx.translate(x,y);
      ctx.scale(s/24, s/24);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      // stylized heart shape
      ctx.moveTo(0,-8);
      ctx.bezierCurveTo(8,-20,32,-10,0,22);
      ctx.bezierCurveTo(-32,-10,-8,-20,0,-8);
      ctx.fill();
      ctx.restore();
    }

    function frame(){
      ctx.clearRect(0,0,W,H);
      // spawn more often but keep them small
      if(hearts.length < 60 && Math.random() < 0.75) hearts.push(spawn());
      for(let i = hearts.length - 1; i >= 0; i--){
        const h = hearts[i];
        h.y += h.vy;
        h.x += Math.sin((h.y + h.s) * 0.02) * 0.5;
        h.a -= 0.0032;
        drawHeart(h.x, h.y, h.s, h.col, Math.max(0,h.a));
        if(h.y < -80 || h.a <= 0) hearts.splice(i,1);
      }
      requestAnimationFrame(frame);
    }
    frame();
  });

  /* ---------- ensure music button visible ---------- */
  safe(function(){ const mb = $id('musicBtn'); if(mb){ mb.style.zIndex = 60; } })();

})();
