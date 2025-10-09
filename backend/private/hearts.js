(() => {
  let c = document.getElementById("heartsCanvas");
  if (!c) {
    c = document.createElement("canvas");
    c.id = "heartsCanvas";
    document.body.prepend(c);
  }
  Object.assign(c.style, { position:"fixed", inset:"0", pointerEvents:"none", zIndex:"0" });

  const ctx = c.getContext("2d");
  const DPR = Math.max(1, window.devicePixelRatio||1);
  let W,H,hearts=[];
  const R = (a,b)=>Math.random()*(b-a)+a;

  function resize(){ W=innerWidth*DPR; H=innerHeight*DPR; c.width=W; c.height=H;
                     c.style.width = innerWidth+"px"; c.style.height = innerHeight+"px"; }
  function spawn(){ if(hearts.length>60) return; hearts.push({
    x:R(0,W), y:H+R(10,200), s:R(12,26), vx:R(-10,10), vy:-R(40,90),
    rot:R(0,Math.PI), vr:R(-0.02,0.02), a:R(0.35,0.9)
  });}
  function draw(h){ ctx.save(); ctx.translate(h.x,h.y); ctx.rotate(h.rot); ctx.scale(h.s,h.s);
    ctx.beginPath(); ctx.moveTo(0,-0.5);
    ctx.bezierCurveTo(0.5,-1.2,1.3,-0.1,0,0.8); ctx.bezierCurveTo(-1.3,-0.1,-0.5,-1.2,0,-0.5);
    ctx.closePath(); ctx.globalAlpha=h.a; ctx.fillStyle="rgba(255,120,160,0.8)"; ctx.fill(); ctx.restore(); }
  function tick(){ ctx.clearRect(0,0,W,H); if(Math.random()<0.25) spawn();
    hearts.forEach(h=>{ h.x+=h.vx*0.016*DPR; h.y+=h.vy*0.016*DPR; h.rot+=h.vr; h.a-=0.0018; });
    hearts = hearts.filter(h=>h.y>-60 && h.a>0); hearts.forEach(draw); requestAnimationFrame(tick); }
  addEventListener("resize", resize, {passive:true}); resize(); tick();
})();
