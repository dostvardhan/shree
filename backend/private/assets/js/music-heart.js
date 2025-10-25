// music-heart.js — site-wide music (skip index), auto-inject, unified IDs
(function(){
  "use strict";

  // --- do not run on index page ---
  try {
    const p = (location.pathname || '').toLowerCase();
    if (p === '/' || p === '/index.html' || p.endsWith('/index.html')) {
      console.debug('[music-heart] skipping on index');
      return;
    }
  } catch(e){}

  if (window.__musicHeartLoaded) return; window.__musicHeartLoaded = true;

  function ready(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function main(){
    // IDs we standardize on:
    // audio: #bgMusicFinal
    // button: #musicHeartBtn (contains .heart span)
    // vol dot: #musicVolDot
    // popover: #musicVolPop
    // range: #musicVolRange
    // mute: #musicMuteBtn

    // map any legacy ids if present
    const legacyAudio = document.getElementById('bgMusic') || document.getElementById('bgMusicHeart');
    const legacyBtn = document.getElementById('musicButton') || document.getElementById('musicHeartBtn');

    // ensure wrap exists
    let wrap = document.getElementById('musicHeartWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'musicHeartWrap';
      wrap.style.position = 'fixed';
      wrap.style.right = '18px';
      wrap.style.bottom = '18px';
      wrap.style.zIndex = '9999';
      wrap.style.display = 'flex';
      wrap.style.gap = '8px';
      wrap.style.alignItems = 'center';
      document.body.appendChild(wrap);
    }

    // audio element
    let audio = document.getElementById('bgMusicFinal') || legacyAudio;
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'bgMusicFinal';
      audio.loop = true; audio.preload = 'auto'; audio.style.display = 'none';
      const src = document.createElement('source');
      src.src = '/music/bg.mp3'; // <-- change if your path differs
      src.type = 'audio/mpeg';
      audio.appendChild(src);
      document.body.appendChild(audio);
    }

    // control button
    let btn = document.getElementById('musicHeartBtn') || legacyBtn;
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'musicHeartBtn';
      btn.type='button';
      btn.setAttribute('aria-label','Play / Pause background music');
      btn.style.width='56px'; btn.style.height='56px';
      btn.style.borderRadius='50%'; btn.style.border='none';
      btn.style.cursor='pointer';
      btn.style.background='radial-gradient(circle at 30% 30%, #ffd6e0, #ff9fb0)';
      btn.style.boxShadow='0 8px 28px rgba(220,80,110,0.14)';
      const span = document.createElement('span'); span.className='heart'; span.textContent='♡';
      btn.appendChild(span);
      wrap.appendChild(btn);
    } else {
      // ensure heart span exists for state icon
      if (!btn.querySelector('.heart')) {
        const span = document.createElement('span'); span.className='heart'; span.textContent='♡';
        btn.textContent=''; btn.appendChild(span);
      }
      // move existing btn into wrap if not inside
      if (!wrap.contains(btn)) wrap.appendChild(btn);
    }

    // volume dot + popover
    let volDot = document.getElementById('musicVolDot');
    if (!volDot) {
      volDot = document.createElement('div'); volDot.id='musicVolDot';
      volDot.className='vol-dot';
      volDot.style.width='18px'; volDot.style.height='18px'; volDot.style.borderRadius='50%';
      volDot.style.background='linear-gradient(150deg,#ffd76d,#ffc96a)';
      volDot.style.boxShadow='0 6px 10px rgba(255,170,100,0.18)';
      volDot.style.border='2px solid rgba(255,255,255,0.9)';
      volDot.style.cursor='pointer';
      volDot.title='Volume';
      wrap.appendChild(volDot);
    }

    let volPop = document.getElementById('musicVolPop');
    if (!volPop) {
      volPop = document.createElement('div'); volPop.id='musicVolPop';
      volPop.className='vol-pop';
      volPop.style.position='fixed'; volPop.style.right='18px'; volPop.style.bottom='84px';
      volPop.style.width='214px'; volPop.style.padding='10px';
      volPop.style.background='linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,250,248,0.95))';
      volPop.style.borderRadius='12px'; volPop.style.boxShadow='0 12px 30px rgba(0,0,0,0.12)';
      volPop.style.zIndex='10000'; volPop.style.display='none'; volPop.style.gap='12px';
      volPop.style.alignItems='center';

      const label = document.createElement('div'); label.textContent='Vol'; label.style.fontSize='13px'; label.style.color='#6b2b2b';
      const range = document.createElement('input'); range.id='musicVolRange'; range.type='range'; range.min='0'; range.max='100'; range.step='1'; range.value='60';
      range.style.width='120px'; range.style.height='6px'; range.style.borderRadius='999px';
      range.style.background='linear-gradient(90deg,#ffc1c1,#ffd88a)'; range.style.outline='none';

      const mute = document.createElement('button'); mute.id='musicMuteBtn';
      mute.textContent='M'; mute.style.border='none'; mute.style.background='#fff'; mute.style.padding='6px'; mute.style.borderRadius='8px'; mute.style.cursor='pointer';

      volPop.appendChild(label); volPop.appendChild(range); volPop.appendChild(mute);
      document.body.appendChild(volPop);
    }

    const volRange = document.getElementById('musicVolRange');
    const muteBtn  = document.getElementById('musicMuteBtn');

    function updateBtn(){
      const heart = btn.querySelector('.heart');
      if (!heart) return;
      if (!audio.paused) { btn.classList.add('playing'); heart.textContent='❤'; btn.setAttribute('aria-pressed','true'); }
      else { btn.classList.remove('playing'); heart.textContent='♡'; btn.setAttribute('aria-pressed','false'); }
    }

    // restore volume
    try {
      const sv = localStorage.getItem('shree_music_volume');
      const v = sv !== null ? Math.max(0, Math.min(100, parseInt(sv,10))) : 60;
      if (volRange) volRange.value = String(v);
      audio.volume = v/100;
    } catch(e){ audio.volume = 0.6; }

    // restore playing (best effort; gesture may be required)
    try {
      if (localStorage.getItem('shree_music_playing') === '1') {
        audio.play().then(updateBtn).catch(()=>{ /* wait for gesture */ });
      }
    } catch(_){}

    // btn toggle
    btn.addEventListener('click', function(e){
      if (audio.paused) {
        audio.play().then(()=>{ try{localStorage.setItem('shree_music_playing','1');}catch(_){ } updateBtn(); }).catch(()=>{});
      } else {
        audio.pause(); try{localStorage.setItem('shree_music_playing','0');}catch(_){ } updateBtn();
      }
    });

    // first gesture resume
    function resumeOnce(){
      if (localStorage.getItem('shree_music_playing') === '1'){
        audio.play().then(updateBtn).catch(()=>{});
      }
      window.removeEventListener('click', resumeOnce, {capture:true});
      window.removeEventListener('touchstart', resumeOnce, {passive:true});
      window.removeEventListener('keydown', resumeOnce, {capture:true});
    }
    window.addEventListener('click', resumeOnce, {capture:true});
    window.addEventListener('touchstart', resumeOnce, {passive:true});
    window.addEventListener('keydown', resumeOnce, {capture:true});

    // volume logic
    function applyVolFromRange(){
      const raw = parseInt(volRange.value||'60',10);
      const v = Math.max(0, Math.min(100, isNaN(raw)?60:raw));
      audio.volume = v/100;
      try { localStorage.setItem('shree_music_volume', String(v)); } catch(_){}
      muteBtn.setAttribute('aria-pressed', (v===0)?'true':'false');
    }
    volRange.addEventListener('input', applyVolFromRange);
    muteBtn.addEventListener('click', ()=>{
      if (audio.volume>0){ volRange.dataset.prev = volRange.value; volRange.value='0'; }
      else { volRange.value = volRange.dataset.prev || '60'; }
      applyVolFromRange();
    });

    // popover show/hide
    document.getElementById('musicVolDot').addEventListener('click', (e)=>{
      e.stopPropagation();
      const showing = (volPop.style.display!=='none');
      volPop.style.display = showing ? 'none' : 'flex';
      if (!showing) setTimeout(()=> volRange.focus(), 40);
    });
    document.addEventListener('click', (e)=>{
      if (!e.target.closest('#musicVolPop') && !e.target.closest('#musicVolDot')){
        volPop.style.display='none';
      }
    });

    // reflect audio events
    audio.addEventListener('play', updateBtn);
    audio.addEventListener('pause', updateBtn);
    audio.addEventListener('volumechange', ()=>{
      try { localStorage.setItem('shree_music_volume', String(Math.round(audio.volume*100))); } catch(_) {}
    });

    updateBtn();
  });
})();
