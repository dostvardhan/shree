(() => {
  const c = document.createElement("canvas");
  c.id = "heartsCanvas";
  c.style.position = "fixed";
  c.style.inset = "0";
  c.style.pointerEvents = "none";
  c.style.zIndex = "5";
  document.body.appendChild(c);

  const ctx = c.getContext("2d");
  let DPR = Math.max(1, window.devicePixelRatio || 1);
  let W, H, hearts = [];

  function resize() {
    W = innerWidth * DPR;
    H = innerHeight * DPR;
    c.width = W; c.height = H;
    c.style.width = innerWidth + "px";
    c.style.height = innerHeight + "px";
  }
  function rand(a,b){ return Math.random()*(b-a)+a; }

  function spawn(){
    if (hearts.length > 60) return;
    hearts.push({
      x: rand(0, W), y: H + rand(10, 200),
      s: rand(12, 26),
      vx: rand(-10, 10), vy: -rand(40, 90),
      a: rand(0.35, 0.9),
      rot: rand(0, Math.PI), vr: rand(-0.02, 0.02)
    });
  }
  function draw(h) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.scale(h.s, h.s);
    ctx.beginPath();
    ctx.moveTo(0, -0.5);
    ctx.bezierCurveTo(0.5, -1.2, 1.3, -0.1, 0, 0.8);
    ctx.bezierCurveTo(-1.3, -0.1, -0.5, -1.2, 0, -0.5);
    ctx.closePath();
    ctx.globalAlpha = h.a;
    ctx.fillStyle = "rgba(255,120,160,0.8)";
    ctx.fill();
    ctx.restore();
  }
  function tick(){
    ctx.clearRect(0,0,W,H);
    if (Math.random() < 0.25) spawn();
    hearts.forEach(h => {
      h.x += h.vx * 0.016 * DPR;
      h.y += h.vy * 0.016 * DPR;
      h.rot += h.vr;
      h.a  -= 0.0018;
    });
    hearts = hearts.filter(h => h.y > -60 && h.a > 0);
    hearts.forEach(draw);
    requestAnimationFrame(tick);
  }

  addEventListener("resize", resize, { passive: true });
  resize(); tick();
})();

