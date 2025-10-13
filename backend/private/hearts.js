// 🌈 Floating Pastel Hearts (Canvas Version)
// Smooth pastel animation with glowing effect above all content

(() => {
  const c = document.createElement("canvas");
  c.id = "fxCanvas";
  Object.assign(c.style, {
    position: "fixed",
    left: 0,
    top: 0,
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: 120, // above photos
  });
  document.body.appendChild(c);

  const ctx = c.getContext("2d");
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  let W = 0, H = 0, hearts = [];

  const COLORS = [
    "#ff9aa2", "#ffb7b2", "#ffdac1", "#e2f0cb",
    "#b5ead7", "#c7ceea", "#f6e6ff", "#fff5ba"
  ];

  function R(a, b) { return Math.random() * (b - a) + a; }

  function resize() {
    W = innerWidth * DPR;
    H = innerHeight * DPR;
    c.width = W;
    c.height = H;
    c.style.width = "100vw";
    c.style.height = "100vh";
  }

  function spawn() {
    if (hearts.length > 24) return;
    hearts.push({
      x: R(0, W),
      y: H + R(20, 160),
      s: R(10, 30),
      vx: R(-0.2, 0.2),
      vy: -R(0.6, 1.2),
      a: R(0.6, 1),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      r: R(-0.3, 0.3),
      vr: R(-0.002, 0.002)
    });
  }

  function drawHeart(x, y, s, a, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.globalAlpha = a;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(0, -0.5);
    ctx.bezierCurveTo(0.5, -1, 1, 0, 0, 1);
    ctx.bezierCurveTo(-1, 0, -0.5, -1, 0, -0.5);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }

  function tick() {
    ctx.clearRect(0, 0, W, H);
    if (Math.random() < 0.12) spawn();

    hearts.forEach(h => {
      h.x += h.vx * 60;
      h.y += h.vy * 60;
      h.r += h.vr;
      h.a -= 0.002;
    });

    hearts = hearts.filter(h => h.a > 0 && h.y > -50);
    hearts.forEach(h => drawHeart(h.x, h.y, h.s / 50 * DPR, h.a, h.r, h.color));

    requestAnimationFrame(tick);
  }

  addEventListener("resize", resize);
  resize();
  tick();
})();
