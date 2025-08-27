// gallery.js
const API = "https://shree-drive.onrender.com";

// batching + concurrency (safe defaults for STATUS_BREAKPOINT issues)
const BATCH_SIZE = 12;
const CONCURRENCY = 2;

// Optional captions
const captionById = {};
const captionByName = {};
const defaultSecondCaption = "“Jahan dil lage, wahi ghar hai.”";

function getCaption(file, index) {
  if (captionById[file.id]) return captionById[file.id];
  if (captionByName[file.name]) return captionByName[file.name];
  if (index === 1) return defaultSecondCaption;
  return "";
}

async function getToken() {
  if (!window.netlifyIdentity) return null;
  try { window.netlifyIdentity.init(); } catch (_) {}
  const u = window.netlifyIdentity.currentUser();
  if (!u) return null;
  try { return await u.jwt(); } catch { return null; }
}

function makeCardSkeleton(name='Loading…') {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <div class="media"><div class="skeleton"></div></div>
    <div class="meta"><div class="name">${name}</div></div>
  `;
  return div;
}

function fillCard(card, file, blobUrl, caption) {
  const viewHref = `https://drive.google.com/file/d/${file.id}/view`;

  // Replace skeleton with image inside a link
  const mediaHolder = card.querySelector('.media');
  const a = document.createElement('a');
  a.className = 'media';
  a.href = viewHref;
  a.target = '_blank';
  a.rel = 'noopener';

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = file.name;
  img.src = blobUrl;

  img.addEventListener('load', () => {
    // release memory shortly after load
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
  });

  a.appendChild(img);
  mediaHolder.replaceWith(a);

  const meta = card.querySelector('.meta');
  const nameEl = card.querySelector('.name');
  nameEl.textContent = file.name;

  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'caption';
    cap.textContent = caption;
    meta.appendChild(cap);
  }

  const row = document.createElement('div');
  row.className = 'row';
  const viewBtn = document.createElement('a');
  viewBtn.className = 'btn';
  viewBtn.href = viewHref;
  viewBtn.target = '_blank';
  viewBtn.rel = 'noopener';
  viewBtn.textContent = 'View';
  row.appendChild(viewBtn);
  meta.appendChild(row);
}

async function fetchImageBlobURL(id, token) {
  const res = await fetch(`${API}/file/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// State
let FILES = [];
let NEXT_INDEX = 0;
let TOKEN = null;

function updateButtons() {
  const btn = document.getElementById('loadMore');
  if (!btn) return;
  if (NEXT_INDEX >= FILES.length) btn.classList.add('hide');
  else btn.classList.remove('hide');
}

async function renderNextBatch() {
  const status = document.getElementById("status");
  const grid = document.getElementById("gallery");
  const start = NEXT_INDEX;
  const end = Math.min(FILES.length, NEXT_INDEX + BATCH_SIZE);
  if (start >= end) { updateButtons(); return; }

  // skeletons
  const cards = [];
  for (let i = start; i < end; i++) {
    const c = makeCardSkeleton('Loading…');
    grid.appendChild(c);
    cards.push(c);
  }

  // tasks with limited concurrency
  let completed = 0;
  const total = end - start;

  const tasks = FILES.slice(start, end).map((file, idx) => async () => {
    try {
      const url = await fetchImageBlobURL(file.id, TOKEN);
      const caption = getCaption(file, start + idx);
      fillCard(cards[idx], file, url, caption);
    } catch (e) {
      console.error('img fail', file.id, e);
      cards[idx].querySelector('.name').textContent = file.name + ' (failed)';
    } finally {
      completed++;
      status.textContent = `Loading ${completed}/${total}… (${end}/${FILES.length})`;
    }
  });

  const runners = new Array(CONCURRENCY).fill(0).map(async () => {
    while (tasks.length) {
      const job = tasks.shift();
      if (job) await job();
    }
  });
  await Promise.all(runners);

  NEXT_INDEX = end;
  status.textContent = `Showing ${NEXT_INDEX}/${FILES.length} photos`;
  updateButtons();
}

async function initGallery() {
  const status = document.getElementById("status");
  const grid = document.getElementById("gallery");
  const loadMoreBtn = document.getElementById("loadMore");

  status.textContent = "Loading…";

  TOKEN = await getToken();
  if (!TOKEN) {
    status.textContent = "Please log in to view the private gallery.";
    return;
  }

  // fetch list (first 200 metadata)
  try {
    const res = await fetch(`${API}/list?pageSize=200`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error('List failed');
    FILES = (data.files || []).filter(f => (f.mimeType || '').startsWith('image/'));
  } catch (e) {
    console.error(e);
    status.textContent = "Error loading gallery.";
    return;
  }

  if (!FILES.length) {
    status.textContent = "No photos yet.";
    grid.innerHTML = "";
    return;
  }

  status.textContent = `Found ${FILES.length} photos`;

  // initial batch
  NEXT_INDEX = 0;
  updateButtons();
  await renderNextBatch();

  // button handler
  if (loadMoreBtn) loadMoreBtn.onclick = () => renderNextBatch();
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.netlifyIdentity) {
    window.netlifyIdentity.on("init", initGallery);
    window.netlifyIdentity.on("login", initGallery);
    window.netlifyIdentity.on("logout", () => location.href='/login.html');
  }
  initGallery();
});
