// backend/private/music-player.js
(function(){
  if (window.__shreeMusicInit) return; window.__shreeMusicInit = true;

  // small round control
  const root = document.createElement('div');
  Object.assign(root.style, { position:'fixed', right:'18px', bottom:'18px', zIndex:999, display:'flex', alignItems:'center', gap:'8px' });

  const btn = document.createElement('button');
  btn.title = 'Open player / Play / Pause';
  btn.style.width = '56px'; btn.style.height = '56px'; btn.style.borderRadius = '999px';
  btn.style.border = 'none'; btn.style.boxShadow = '0 12px 30px rgba(0,0,0,.18)'; btn.style.cursor='pointer';
  btn.innerHTML = '▶';
  root.appendChild(btn);

  const volIcon = document.createElement('span'); volIcon.style.display='none';
  root.appendChild(volIcon);

  document.body.appendChild(root);

  let playerWin = null;
  function ensurePlayer(){
    try {
      playerWin = window.open('/private/player.html', 'shreePlayer', 'width=420,height=120');
      if (playerWin) playerWin.focus();
      return playerWin;
    } catch(e) {
      return null;
    }
  }

  // Post a command to the popup (if available). If not available, try to open it.
  function postCmd(cmd, payload){
    try {
      if (!playerWin || playerWin.closed) {
        playerWin = ensurePlayer();
      }
      if (playerWin && !playerWin.closed) {
        playerWin.postMessage(Object.assign({ cmd }, payload || {}), location.origin);
        return true;
      }
    } catch(e){}
    return false;
  }

  // Toggle button behavior
  btn.addEventListener('click', async () => {
    // if popup exists, toggle; otherwise open it
    if (!playerWin || playerWin.closed) {
      playerWin = ensurePlayer();
      // small delay then toggle play
      setTimeout(()=> postCmd('toggle'), 400);
    } else {
      postCmd('toggle');
    }
  });

  // volume keyboard: M to mute (sends to popup)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') postCmd('toggle');
  });

  // Try to detect when popup is ready using message listener (optional)
  window.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.from === 'shreePlayer' && ev.data.ready) {
      // player is ready
    }
  }, false);
})();
