// backend/private/assets/js/music-heart.js
(function(){
  "use strict";
  // guard: run once
  if (window.__shree_music_loaded) return;
  window.__shree_music_loaded = true;

  try {
    console.debug('[music-heart] init');

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
      console.debug('[music-heart] injected DOM');
    }

    const audio = document.getElementById('bgMusicFinal');
    const btn = document.getElementById('musicHeartBtn');
    const volDot = document.getElementById('musicVolDot');
    const volPop = document.getElementById('musicVolPop');
    const volRange = document.getElementById('musicVolRange');
    const muteBtn = document.getElementById('musicMuteBtn');

    if (!audio) { console.warn('[music-heart] audio element not found (bgMusicFinal) — aborting'); return; }
    if (!btn) { console.warn('[music-heart] music button not found — aborting'); return; }

    // restore saved volume/playing
    try {
      const sv = localStorage.getItem('shree_music_volume');
      if (sv !== null && volRange) {
        const v = Math.max(0, Math.min(100, parseInt(sv,10)));
        volRange.value = String(v);
        audio.volume = v / 100;
      } else {
        // default
        if (volRange) volRange.value = '60';
        audio.volume = 0.6;
      }
    } catch(e){
      console.warn('[music-heart] localStorage read error', e);
      if (volRange) volRange.value = '60';
      audio.volume = 0.6;
    }

    function updateBtn() {
      if (!btn) return;
      const heart = btn;
      if (!audio.paused) {
        heart.classList.add('playing');
        heart.textContent = '❤';
        heart.setAttribute('aria-pressed','true');
      } else {
        heart.classList.remove('playing');
        heart.textContent = '♡';
        heart.setAttribute('aria-pressed','false');
      }
    }

    btn.addEventListener('click', function(e){
      e.preventDefault();
      if (audio.paused) {
        audio.play().then(()=>{ localStorage.setItem('shree_music_playing','1'); updateBtn(); })
        .catch((err)=>{ console.warn('[music-heart] play() failed', err); });
      } else {
        audio.pause();
        try { localStorage.setItem('shree_music_playing','0'); } catch(e){}
        updateBtn();
      }
    });

    if (volDot) {
      volDot.addEventListener('click', function(e){
        e.stopPropagation();
        if (!volPop) return;
        const show = volPop.classList.toggle('show');
        volPop.setAttribute('aria-hidden', show ? 'false' : 'true');
        if (show && volRange) setTimeout(()=>volRange.focus(),40);
      });

      volDot.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); volDot.click(); }
      });
    }

    if (volRange) {
      volRange.addEventListener('input', function(){
        const raw = volRange.value;
        const v = Math.max(0, Math.min(100, parseInt(raw,10) || 0));
        audio.volume = v / 100;
        try { localStorage.setItem('shree_music_volume', String(v)); } catch(e){ console.warn('[music-heart] save vol failed', e); }
        if (muteBtn) muteBtn.setAttribute('aria-pressed', audio.volume === 0 ? 'true' : 'false');
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', function(){
        // protect if volRange missing
        if (!volRange) {
          audio.volume = audio.volume > 0 ? 0 : 0.6;
          try { localStorage.setItem('shree_music_volume', String(Math.round(audio.volume*100))); } catch(e){}
          return;
        }
        try {
          if (audio.volume > 0) {
            volRange.dataset.prev = volRange.value || '60';
            volRange.value = '0';
          } else {
            volRange.value = volRange.dataset.prev || '60';
          }
          // trigger input handler
          volRange.dispatchEvent(new Event('input'));
        } catch(err){
          console.warn('[music-heart] mute click failed', err);
        }
      });
    }

    document.addEventListener('click', function(e){
      if (!volPop) return;
      if (!e.target.closest('.vol-pop') && !e.target.closest('#musicVolDot')) {
        volPop.classList.remove('show');
        volPop.setAttribute('aria-hidden','true');
      }
    });

    audio.addEventListener('play', updateBtn);
    audio.addEventListener('pause', updateBtn);
    audio.addEventListener('volumechange', function(){
      try{ localStorage.setItem('shree_music_volume', String(Math.round(audio.volume*100))); } catch(e){ console.warn('[music-heart] volumechange save failed', e); }
    });

    // try autoplay; if blocked, wait for user interaction
    audio.play().then(()=>{ updateBtn(); }).catch(()=> {
      function userStart() {
        audio.play().then(()=>{ try{ localStorage.setItem('shree_music_playing','1'); }catch(e){}; updateBtn(); }).catch(()=>{});
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
      if (localStorage.getItem('shree_music_playing') === '1') {
        audio.play().then(()=>updateBtn()).catch(()=>{});
      }
    } catch(e){ console.warn('[music-heart] restore playing state failed', e); }

    updateBtn();
    console.debug('[music-heart] ready');
  } catch(err) {
    console.warn('music-heart script error', err);
  }
})();
