(() => {
  const c = document.createElement('canvas');
  c.id = 'heartsCanvas';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  let W, H, hearts = [], DPR = window.devicePixelRatio || 1;

  function resize(){
    W = window.innerWidth * DPR;
    H = window.innerHeight * DPR;
    c.width = W; c.height = H;
    c.style.width = window.innerWidth + 'px';
    c.style.height = window.innerHeight + 'px';
  }

  function spawn(){
    hearts.push({
      x: Math.random()*W,
      y: H + 30,
      s: 12 + Math.random()*14,
      vy: 30 + Math.random()*50,
      a: 0.6 + Math.random()*0.4
    });
  }

  function draw(h){
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.scale(h.s, h.s);
    ctx.beginPath();
    ctx.moveTo(0, -0.5);
    ctx.bezierCurveTo(0.5, -1.2, 1.3, -0.1, 0, 0.8);
    ctx.bezierCurveTo(-1.3, -0.1, -0.5, -1.2, 0, -0.5);
    ctx.closePath();
    ctx.globalAlpha = h.a;
    ctx.fillStyle = 'rgba(255,105,180,0.7)';
    ctx.fill();
    ctx.restore();
  }

  function tick(){
    ctx.clearRect(0,0,W,H);
    if(Math.random() < 0.2) spawn();
    hearts.forEach(h => {
      h.y -= h.vy * 0.016 * DPR;
      h.x += Math.sin(h.y / 50) * 0.5;
      h.a -= 0.002;
    });
    hearts = hearts.filter(h => h.y > -40 && h.a > 0);
    hearts.forEach(draw);
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  resize();
  tick();
})();
