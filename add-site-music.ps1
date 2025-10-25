# site-wide music insert script

$musicRel = "backend\private\gallery-music.mp3"
if (-not (Test-Path $musicRel)) {
  Write-Host "ERROR: $musicRel missing" -ForegroundColor Red
  exit 1
}

$snippet = @"
<!-- START: site-wide background music widget -->
<audio id="bgMusic" src="/gallery-music.mp3" loop preload="metadata"></audio>
<div id="musicWidget" style="position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;gap:8px;align-items:center;">
  <button id="musicPlayBtn" style="background:#6e2430;color:#fff;border-radius:999px;padding:8px 12px;cursor:pointer">▶</button>
  <input id="musicVol" type="range" min="0" max="1" step="0.05" value="0.9" style="width:80px">
</div>
<script>
(function(){
  const audio=document.getElementById('bgMusic'),btn=document.getElementById('musicPlayBtn'),vol=document.getElementById('musicVol');
  btn.addEventListener('click',()=>{ if(audio.paused){audio.play();btn.textContent='⏸'} else{audio.pause();btn.textContent='▶'} });
  vol.addEventListener('input',e=>audio.volume=+e.target.value);
})();
</script>
<!-- END: site-wide background music widget -->
"@

$htmlFiles = Get-ChildItem "backend\private" -Filter "*.html"
foreach ($f in $htmlFiles) {
  $t = Get-Content -Raw $f.FullName
  if ($t -match "<!-- START: site-wide background music widget") { continue }
  $n = $t -replace '(?i)</body>', "$snippet`n</body>"
  Set-Content $f.FullName $n -Encoding UTF8
  Write-Host "Music widget inserted: $($f.Name)" -ForegroundColor Green
}

git add $musicRel
git add backend/private/*.html
git commit -m "feat: add simple site-wide music widget"
git push origin main
