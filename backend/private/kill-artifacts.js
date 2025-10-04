// === START: artifact killer ===
(function(){
  const BAD_RE = /^[\\u00A0\\s¢™©®·º°]+$/;
  const WEAK_RE = /[¢™©®]{1,}/;
  function isArtifactNode(n){
    if(!n) return false;
    if(n.nodeType===3){ const t=n.textContent.trim(); return t && (BAD_RE.test(t) || (WEAK_RE.test(t)&&t.length<=8)); }
    if(n.nodeType===1){ const el=n; const txt=(el.textContent||'').trim(); if(!txt) return false; const cs=getComputedStyle(el); const overlay=(cs.position==='fixed'||cs.position==='absolute') && cs.pointerEvents==='none'; return BAD_RE.test(txt) || (overlay && WEAK_RE.test(txt) && txt.length<=12); }
    return false;
  }
  function cleanTree(root){ if(!root) return; const walker=document.createTreeWalker(root, NodeFilter.SHOW_ALL, null); const doomed=[]; while(walker.nextNode()){ const n=walker.currentNode; if(isArtifactNode(n)){ doomed.push(n.nodeType===3 ? n.parentNode : n); } } doomed.forEach(el=>{ try{ el.remove(); }catch(e){} }); }
  cleanTree(document.body);
  const obs=new MutationObserver(muts=>{ muts.forEach(m=>{ m.addedNodes && m.addedNodes.forEach(n=>{ cleanTree(n.nodeType===1?n:n.parentNode||document.body); }); if(m.type==='characterData'){ cleanTree(m.target.parentNode); } }); });
  obs.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();
// === END: artifact killer ===


