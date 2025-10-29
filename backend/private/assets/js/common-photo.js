// common-photo.js
// Safe, resilient client helpers used by photo1..photo9 pages
(function(){
  /* ---------- helpers ---------- */
  function $id(id){ return document.getElementById(id); }
  function safe(fn){ try{ fn(); }catch(e){ console.warn("common-photo:", e && e.message); } }

  /* ---------- LOGOUT ---------- */
  safe(function(){
    const logout = $id('logoutBtn');
    if(logout){
      logout.addEventListener('click', function(e){
        e.preventDefault();
        // call server logout then always redirect to index
        fetch('/auth/logout', { method:'GET', credentials:'include' })
          .catch(()=>{})
          .finally(()=> { location.href = '/index.html'; });
      }, { passive:true });
    }
  });

  /* ---------- ENSURE HERO STYLES (full-looking) ---------- */
  safe(function(){
    const hero = $id('heroImg');
    if(hero){
      // make the photo look large and centered (responsive)
      hero.style.display = 'block';
      hero.style.margin = '0 auto';
      hero.style.width = 'min(1100px, 88vw)';
      hero.style.maxHeight = '86vh';
      hero.style.objectFit = 'cover';
      hero.style.cursor = 'zoom-in';
      hero.style.borderRadius = '10px';
      // ensure the outer main/frame (if present) doesn't shrink it too small
      const main = document.querySelector('main') || document.body;
      main.style.maxWidth = main.style.maxWidth || '1200px';
      main.style.margin = main.style.margin || '28px auto';
      main.style.padding = main.style.padding || '0 18px 70px';
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
      img.style.maxWidth = '96vw';
      img.style.maxHeight = '94vh';
      img.style.borderRadius = '10px';
      img.style.boxShadow = '0 30px 80px rgba(0,0,0,.6)';
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

  /* ---------- MUSIC + VOLUME UI ---------- */
  safe(function(){
    const audio = $id('bgMusic');
    const playBtn = $id('musicBtn');
    const volRange = $id('volRange');

    // create minimal audio if not present (so code doesn't break)
    if(!audio){
      const a = document.createElement('audio');
      a.id = 'bgMusic';
      a.loop = true;
      // optional source left blank if none (no audio)
      document.body.appendChild(a);
    }

    const A = $id('bgMusic');
    if(!A) return;

    // restore volume & play preference
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

  /* ---------- FLOATING HEARTS (create canvas if not present) ---------- */
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

    const hearts = [];
    function spawn(){
      return {
        x: Math.random() * W,
        y: H + 20,
        s: 8 + Math.random()*28,
        vy: -1 - Math.random()*1.8,
        a: 0.9 + Math.random()*0.6,
        rot: (Math.random()-0.5) * 0.8
      };
    }
    function drawHeart(x,y,s,alpha){
      ctx.save();
      ctx.translate(x,y);
      ctx.scale(s/24, s/24);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#e07fae";
      ctx.beginPath();
      ctx.moveTo(0,-8);
      ctx.bezierCurveTo(12,-28,48,-14,0,28);
      ctx.bezierCurveTo(-48,-14,-12,-28,0,-8);
      ctx.fill();
      ctx.restore();
    }
    function frame(){
      ctx.clearRect(0,0,W,H);
      if(hearts.length < 36 && Math.random() < 0.55) hearts.push(spawn());
      for(let i=hearts.length-1;i>=0;i--){
        const h = hearts[i];
        h.y += h.vy;
        h.x += Math.sin((h.y + h.s) * 0.01) * 0.6;
        h.a -= 0.003;
        drawHeart(h.x, h.y, h.s, Math.max(0,h.a));
        if(h.y < -60 || h.a <= 0) hearts.splice(i,1);
      }
      requestAnimationFrame(frame);
    }
    frame();
  });

  /* ---------- ensure music button shows (UX) ---------- */
  safe(function(){ const mb = $id('musicBtn'); if(mb){ mb.style.zIndex = 60; }})();
})();
