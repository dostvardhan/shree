// music-player.js
// Tiny, cute, persistent music player UI.
// Usage: include <script src="/music-player.js" defer></script> on pages (except index.html)

(function(){
  // avoid double-init
  if (window.__musicPlayerInit) return; window.__musicPlayerInit = true;

  // Create UI container
  const wrapper = document.createElement('div');
  wrapper.id = 'musicWidget';
  wrapper.setAttribute('aria-hidden','false');
  wrapper.style.position = 'fixed';
  wrapper.style.right = '14px';
  wrapper.style.bottom = '14px';
  wrapper.style.zIndex = '230';
  wrapper.style.fontFamily = 'system-ui, sans-serif';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '8px';

  // Tiny circular button
  const btn = document.createElement('button');
  btn.id = 'musicBtn';
  btn.title = 'Play / Pause background music';
  btn.style.width = '44px';
  btn.style.height = '44px';
  btn.style.borderRadius = '50%';
  btn.style.border = 'none';
  btn.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)';
  btn.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(245,245,255,0.9))';
  btn.style.cursor = 'pointer';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.fontSize = '18px';
  btn.style.padding = '0';
  btn.style.lineHeight = '1';
  btn.style.transition = 'transform .12s ease';
  btn.style.backdropFilter = 'blur(4px)';

  // Icon (initially play)
  const icon = document.createElement('span');
  icon.id = 'musicIcon';
  icon.textContent = '▶️';
  btn.appendChild(icon);

  // small volume slider panel (hidden until toggled)
  const volPanel = document.createElement('div');
  volPanel.id = 'volPanel';
  volPanel.style.display = 'none';
  volPanel.style.alignItems = 'center';
  volPanel.style.padding = '8px';
  volPanel.style.borderRadius = '12px';
  volPanel.style.background = 'rgba(255,255,255,0.95)';
  volPanel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.12)';
  volPanel.style.gap = '8px';
  volPanel.style.flexDirection = 'row';
  volPanel.style.position = 'relative';
  volPanel.style.minWidth = '120px';

  // volume slider
  const volInput = document.createElement('input');
  volInput.type = 'range';
  volInput.min = '0';
  volInput.max = '1';
  volInput.step = '0.01';
  volInput.style.width = '90px';
  volInput.style.cursor = 'pointer';
  volInput.title = 'Volume';

  // small mute icon
  const volIcon = document.createElement('span');
  volIcon.textContent = '🔈';
  volIcon.style.fontSize = '16px';

  volPanel.appendChild(volIcon);
  volPanel.appendChild(volInput);

  // append elements
  wrapper.appendChild(btn);
  wrapper.appendChild(volPanel);
  document.body.appendChild(wrapper);

  // create audio element (stream from /api/music, requires auth cookie)
  const audio = document.createElement('audio');
  audio.id = 'bgAudio';
  audio.loop = true;
  audio.preload = 'auto';
  audio.src = '/api/music';

  // apply saved volume from localStorage (default 0.6)
  const savedVol = parseFloat(localStorage.getItem('shree_bg_vol'));
  audio.volume = (!isNaN(savedVol)) ? savedVol : 0.6;
  volInput.value = audio.volume;

  // update vol icon based on volume
  function refreshVolIcon() {
    if (audio.muted || audio.volume <= 0) volIcon.textContent = '🔇';
    else if (audio.volume < 0.4) volIcon.textContent = '🔈';
    else volIcon.textContent = '🔊';
  }
  refreshVolIcon();

  // try autoplay, show controls if blocked
  function tryAutoplay() {
    audio.play().then(()=> {
      icon.textContent = '⏸';
      btn.style.transform = 'scale(1)';
    }).catch(() => {
      // blocked -> show button (user must press)
      icon.textContent = '▶️';
    });
  }

  // toggle play/pause
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (audio.paused) {
      audio.play().then(()=> {
        icon.textContent = '⏸';
      }).catch(()=> {
        // failed
        icon.textContent = '▶️';
      });
    } else {
      audio.pause();
      icon.textContent = '▶️';
    }
    // show/hide volPanel briefly on click
    volPanel.style.display = (volPanel.style.display === 'flex') ? 'none' : 'flex';
  });

  // volume input behavior
  volInput.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    audio.volume = v;
    audio.muted = false;
    localStorage.setItem('shree_bg_vol', String(v));
    refreshVolIcon();
  });

  // clicking outside hides the panel
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      volPanel.style.display = 'none';
    }
  });

  // keyboard shortcuts: m to mute/unmute
  document.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      audio.muted = !audio.muted;
      refreshVolIcon();
    }
  });

  // reflect play/pause state on audio events
  audio.addEventListener('play', () => { icon.textContent = '⏸'; });
  audio.addEventListener('pause', () => { icon.textContent = '▶️'; });
  audio.addEventListener('volumechange', refreshVolIcon);

  // add audio to DOM (but hidden)
  audio.style.display = 'none';
  document.body.appendChild(audio);

  // attempt autoplay after a small delay (user gesture friendly)
  window.addEventListener('load', () => setTimeout(tryAutoplay, 500));

  // expose quick API for tests
  window._shreeAudio = audio;
})();
