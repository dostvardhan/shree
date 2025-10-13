(function(){
  if (window.__musicPlayerInit) return; window.__musicPlayerInit = true;
  const wrapper = document.createElement('div');
  wrapper.id = 'musicWidget';
  Object.assign(wrapper.style, { position:'fixed', right:'14px', bottom:'14px', zIndex:'230', display:'flex', alignItems:'center', gap:'8px', fontFamily:'system-ui,Segoe UI,Roboto' });

  // round play/pause button (SVG)
  const btn = document.createElement('button');
  Object.assign(btn.style, { width:'44px', height:'44px', borderRadius:'50%', border:'none', boxShadow:'0 6px 18px rgba(0,0,0,0.18)', background:'linear-gradient(135deg,#fff,#f6f6ff)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:'0' });
  btn.title = 'Play / Pause';
  const svgNS = 'http://www.w3.org/2000/svg';
  const iconSVG = document.createElementNS(svgNS,'svg');
  iconSVG.setAttribute('viewBox','0 0 24 24'); iconSVG.setAttribute('width','20'); iconSVG.setAttribute('height','20');
  iconSVG.innerHTML = '<path fill=\"#333\" d=\"M8 5v14l11-7z\"></path>';
  btn.appendChild(iconSVG);

  // tiny volume panel
  const volPanel = document.createElement('div');
  Object.assign(volPanel.style, { display:'none', alignItems:'center', padding:'8px', borderRadius:'12px', background:'rgba(255,255,255,0.95)', boxShadow:'0 10px 30px rgba(0,0,0,0.12)', gap:'8px', minWidth:'140px' });
  const volIcon = document.createElement('span'); volIcon.textContent = '🔈';
  const volInput = document.createElement('input'); volInput.type='range'; volInput.min='0'; volInput.max='1'; volInput.step='0.01'; volInput.style.width='90px'; volInput.title='Volume';
  volPanel.appendChild(volIcon); volPanel.appendChild(volInput);

  wrapper.appendChild(btn); wrapper.appendChild(volPanel);
  document.body.appendChild(wrapper);

  // hidden audio element (source from protected endpoint)
  const audio = document.createElement('audio');
  audio.id = 'shreeBgAudio';
  audio.loop = true;
  audio.preload = 'auto';
  audio.style.display = 'none';
  document.body.appendChild(audio);

  // persistent volume
  const savedVol = parseFloat(localStorage.getItem('shree_bg_vol'));
  audio.volume = (!isNaN(savedVol)) ? savedVol : 0.6;
  volInput.value = audio.volume;

  function refreshVolIcon(){
    if (audio.muted || audio.volume <= 0) volIcon.textContent = '🔇';
    else if (audio.volume < 0.4) volIcon.textContent = '🔈';
    else volIcon.textContent = '🔊';
  }
  refreshVolIcon();

  // set audio src lazily (only when user interacts)
  let audioReady = false;
  function ensureAudioSrc(){
    if (audioReady) return Promise.resolve(true);
    return fetch('/api/music', { method:'HEAD', credentials:'include' }).then(r => {
      if (!r.ok) throw new Error('not available');
      audio.src = '/api/music';
      audioReady = true;
      return true;
    });
  }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (volPanel.style.display === 'flex') volPanel.style.display = 'none'; else volPanel.style.display = 'flex';
    try {
      await ensureAudioSrc();
      if (audio.paused) { await audio.play(); } else { audio.pause(); }
    } catch (err) {
      btn.animate([{transform:'scale(1)'},{transform:'scale(0.96)'},{transform:'scale(1)'}], { duration:400 });
      console.warn('Music not available (likely not logged-in):', err);
    }
  });

  audio.addEventListener('play', ()=>{ iconSVG.innerHTML = '<path fill=\"#333\" d=\"M6 19h4V5H6zm8-14v14h4V5z\"></path>'; btn.style.boxShadow='0 8px 22px rgba(0,0,0,0.22)';});
  audio.addEventListener('pause', ()=>{ iconSVG.innerHTML = '<path fill=\"#333\" d=\"M8 5v14l11-7z\"></path>'; btn.style.boxShadow='0 6px 18px rgba(0,0,0,0.18)';});

  volInput.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    audio.volume = v; audio.muted = false; localStorage.setItem('shree_bg_vol', String(v)); refreshVolIcon();
  });

  document.addEventListener('click', (e)=> { if (!wrapper.contains(e.target)) volPanel.style.display='none'; });
  document.addEventListener('keydown', (e)=> { if (e.key === 'm' || e.key === 'M') { audio.muted = !audio.muted; refreshVolIcon(); }});

  // expose for debugging
  window._shreeAudio = audio;
})();
