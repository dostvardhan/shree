(function(){
  "use strict";
  // guard: run once
  if (window.__shree_music_loaded) return;
  window.__shree_music_loaded = true;

  try {
    // ensure container only once
    if (!document.getElementById('musicHeartWrap')) {
      const wrap = document.createElement('div');
      wrap.id = 'musicHeartWrap';
      wrap.innerHTML = `
        <audio id="bgMusicFinal" loop preload="auto" style="display:none">
          <source src="/music/bg.mp3" type="audio/mpeg">
        </audio>
        <button id="musicHeartBtn" aria-label="Toggle background music" title="Play / Pause" type="button">♡</button>
        <div id="musicVolDot" role="button" tabindex="0" aria-label="Volume control" title="Volume">●</div>
        <div id="musicVolPop" class="vol-pop" aria-hidden="true" style="display:none">
          <div style="font-size:13px;color:#6b2b2b;margin-right:6px">Vol</div>
          <input id="musicVolRange" class="vol-range" type="range" min="0" max="100" step="1" value="60" />
          <button id="musicMuteBtn" style="border:none;background:#fff;padding:6px;border-radius:8px;cursor:pointer" aria-pressed="false" title="Mute/unmute">M</button>
        </div>
      `;
      // append to body
      document.body.appendChild(wrap);
    }

    const audio = document.getElementById('bgMusicFinal');
    const btn = document.getElementById('musicHeartBtn');
    const volDot = document.getElementById('musicVolDot');
    const volPop = document.getElementById('musicVolPop');
    const volRange = document.getElementById('musicVolRange');
    const muteBtn = document.getElementById('musicMuteBtn');

    if (!audio || !btn) return;

    // restore saved volume/playing
    try {
      const sv = localStorage.getItem('shree_music_volume');
      if (sv !== null && volRange) volRange.value = sv;
      audio.volume = sv !== null ? (Math.max(0, Math.min(100, parseInt(sv,10))) / 100) : 0.6;
    } catch(e){}

    function updateBtn() {
      if (!btn) return;
      const heart = btn;
      if (!audio.paused) { heart.classList.add('playing'); heart.textContent = '❤'; heart.setAttribute('aria-pressed','true'); }
      else { heart.classList.remove('playing'); heart.textContent = '♡'; heart.setAttribute('aria-pressed','false'); }
    }

    btn.addEventListener('click', function(e){
      e.preventDefault();
      if (audio.paused) {
        audio.play().then(()=>{ localStorage.setItem('shree_music_playing','1'); updateBtn(); }).catch(()=>{});
      } else {
        audio.pause();
        localStorage.setItem('shree_music_playing','0');
        updateBtn();
      }
    });

    volDot.addEventListener('click', function(e){
      e.stopPropagation();
      const show = volPop.classList.toggle('show');
      volPop.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (show && volRange) setTimeout(()=>volRange.focus(),40);
    });

    volDot.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); volDot.click(); }});

    if (volRange) {
      volRange.addEventListener('input', function(){
        const v = Math.max(0, Math.min(100, parseInt(volRange.value,10)));
        audio.volume = v/100;
        try { localStorage.setItem('shree_music_volume', String(v)); } catch(e){}
        muteBtn && muteBtn.setAttribute('aria-pressed', audio.volume === 0 ? 'true' : 'false');
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', function(){
        if (audio.volume > 0) { volRange.dataset.prev = volRange.value; volRange.value = 0; }
        else { volRange.value = volRange.dataset.prev || 60; }
        volRange && volRange.dispatchEvent(new Event('input'));
      });
    }

    document.addEventListener('click', function(e){
      if (!e.target.closest('.vol-pop') && !e.target.closest('#musicVolDot')) {
        volPop && volPop.classList.remove('show');
        volPop && volPop.setAttribute('aria-hidden','true');
      }
    });

    audio.addEventListener('play', updateBtn);
    audio.addEventListener('pause', updateBtn);
    audio.addEventListener('volumechange', function(){ try{ localStorage.setItem('shree_music_volume', String(Math.round(audio.volume*100))); } catch(e){} });

    // try autoplay; if blocked, wait for user interaction
    audio.play().then(()=>{ updateBtn(); }).catch(()=> {
      function userStart() {
        audio.play().then(()=>{ localStorage.setItem('shree_music_playing','1'); updateBtn(); }).catch(()=>{});
        window.removeEventListener('click', userStart, {capture:true});
        window.removeEventListener('touchstart', userStart, {passive:true});
        window.removeEventListener('keydown', userStart, {capture:true});
      }
      window.addEventListener('click', userStart, {capture:true});
      window.addEventListener('touchstart', userStart, {passive:true});
      window.addEventListener('keydown', userStart, {capture:true});
    });

    // restore play visual if previously playing (best-effort)
    try {
      if (localStorage.getItem('shree_music_playing') === '1') { audio.play().then(()=>updateBtn()).catch(()=>{}); }
    } catch(e){}

    updateBtn();
  } catch(err) { console.warn('music-heart script error', err); }
})();
