(function(){
  if (window.__musicPlayerCompact) return; window.__musicPlayerCompact = true;

  // tiny compact widget container
  const container = document.createElement('div');
  container.id = 'shree-music-compact';
  Object.assign(container.style, {
    position: 'fixed',
    right: '14px',
    bottom: '14px',
    zIndex: '260',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    pointerEvents: 'auto',
    fontFamily: 'system-ui, -apple-system, \"Segoe UI\", Roboto'
  });

  // round button
  const btn = document.createElement('button');
  btn.setAttribute('aria-label','Play / Pause music');
  Object.assign(btn.style, {
    width: '44px', height: '44px', borderRadius: '50%',
    border: 'none', background: 'white', boxShadow: '0 6px 18px rgba(0,0,0,0.16)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0'
  });

  // small play icon SVG
  const svgNS = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(svgNS,'svg');
  icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('width','20'); icon.setAttribute('height','20');
  icon.innerHTML = '<path fill=\"#333\" d=\"M8 5v14l11-7z\"></path>';
  btn.appendChild(icon);

  // volume slider (shown on hover)
  const volWrap = document.createElement('div');
  Object.assign(volWrap.style, { display:'none', alignItems:'center', padding:'6px 10px', borderRadius:'12px', background:'rgba(255,255,255,0.96)', boxShadow:'0 10px 30px rgba(0,0,0,0.12)' });
  const vol = document.createElement('input');
  vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.01; vol.value = localStorage.getItem('shree_bg_vol') || 0.55;
  Object.assign(vol.style, { width:'110px' });
  volWrap.appendChild(vol);

  container.appendChild(btn);
  container.appendChild(volWrap);
  document.body.appendChild(container);

  // audio element (lazy src)
  const audio = document.createElement('audio'); audio.id='shreeCompactAudio'; audio.loop = true; audio.style.display='none';
  document.body.appendChild(audio);
  audio.volume = Number(vol.value);

  // show volume on hover
  container.addEventListener('mouseenter', () => { volWrap.style.display = 'flex'; });
  container.addEventListener('mouseleave', () => { volWrap.style.display = 'none'; });

  // set src lazily (HEAD-check)
  let ready=false;
  function loadSrc(){
    if (ready) return Promise.resolve(true);
    return fetch('/api/music',{method:'HEAD', credentials:'include'}).then(r => {
      if (!r.ok) throw new Error('not allowed');
      audio.src = '/api/music';
      ready = true;
      return true;
    });
  }

  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      await loadSrc();
      if (audio.paused) await audio.play(); else audio.pause();
    } catch (err) {
      // tiny shake to indicate failure
      btn.animate([{transform:'translateY(0)'},{transform:'translateY(-4px)'},{transform:'translateY(0)'}], {duration:300});
      console.warn('Music not available:', err);
    }
  });

  vol.addEventListener('input', e => {
    const v = Number(e.target.value); audio.volume = v; localStorage.setItem('shree_bg_vol', String(v));
  });

  audio.addEventListener('play', ()=> icon.innerHTML = '<path fill=\"#333\" d=\"M6 19h4V5H6zm8-14v14h4V5z\"></path>');
  audio.addEventListener('pause', ()=> icon.innerHTML = '<path fill=\"#333\" d=\"M8 5v14l11-7z\"></path>');

  window._shreeCompactAudio = audio;
})();
