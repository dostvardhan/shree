// === gallery.js (safe version) ===

// ---- CONFIG ----
const API_BASE = 'https://shree-drive.onrender.com'; // जरुरत पड़े तो बदल लेना
const PAGE_SIZE = 6; // "Load 6 more" से match

// ---- STATE ----
let state = {
  jwt: null,
  files: [],
  page: 0,
  loading: false,
  destroyed: false,
  io: null, // IntersectionObserver
};

// ---- DOM ----
const $status = document.getElementById('status');
const $grid = document.getElementById('gallery');
const $loadMore = document.getElementById('loadMore');

// Utility: safe set text
function setStatus(msg) {
  if ($status) $status.textContent = msg || '';
}

// Utility: delay
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Abortable fetch with timeout
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Build Drive preview URL
function drivePreviewUrl(fileId) {
  return `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}&export=view`;
}

// Create a card skeleton
function createCardSkeleton() {
  const card = document.createElement('div');
  card.className = 'card';

  const media = document.createElement('div');
  media.className = 'media';
  const sk = document.createElement('div');
  sk.className = 'skeleton';
  media.appendChild(sk);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `
    <div class="name muted">Loading…</div>
    <div class="caption muted">Please wait</div>
  `;

  card.appendChild(media);
  card.appendChild(meta);
  return card;
}

// Render a single file card
function createFileCard(file) {
  const card = document.createElement('div');
  card.className = 'card';

  const media = document.createElement('div');
  media.className = 'media';

  const img = document.createElement('img');
  img.alt = file.name || 'image';

  // Lazy loading via IntersectionObserver
  img.dataset.src = drivePreviewUrl(file.id);

  // Fallback on error
  img.addEventListener('error', () => {
    img.replaceWith(Object.assign(document.createElement('div'), {
      textContent: 'Preview not available',
      className: 'muted',
      style: 'padding:16px; font-size:12px;'
    }));
  });

  media.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const sizeKB = file.size ? Math.round(Number(file.size) / 1024) : null;

  meta.innerHTML = `
    <div class="name" title="${file.name || ''}">${file.name || '(no name)'}</div>
    <div class="caption">
      ${file.mimeType || 'file'}${sizeKB ? ` · ${sizeKB} KB` : ''}
    </div>
    <div class="row">
      <a class="btn" target="_blank" rel="noopener" href="https://drive.google.com/file/d/${file.id}/view">Open</a>
      <span class="muted">${file.id.slice(0, 8)}…</span>
    </div>
  `;

  card.appendChild(media);
  card.appendChild(meta);
  return card;
}

// Setup IntersectionObserver for lazy images
function ensureObserver() {
  if (state.io) return state.io;
  state.io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const src = img.dataset.src;
        if (src && !img.src) {
          img.src = src;
        }
        state.io.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });
  return state.io;
}

// Attach observer to all imgs without src
function observeNewImages(rootEl) {
  const io = ensureObserver();
  const imgs = rootEl.querySelectorAll('img[data-src]:not([src])');
  imgs.forEach(img => io.observe(img));
}

// Render next page chunk
function renderNextPage() {
  const start = state.page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, state.files.length);
  if (start >= end) {
    $loadMore.classList.add('hide');
    return;
  }

  const frag = document.createDocumentFragment();

  for (let i = start; i < end; i++) {
    const file = state.files[i];
    frag.appendChild(createFileCard(file));
  }

  $grid.appendChild(frag);
  observeNewImages($grid);

  state.page += 1;

  if (state.page * PAGE_SIZE < state.files.length) {
    $loadMore.classList.remove('hide');
  } else {
    $loadMore.classList.add('hide');
  }
}

// Fetch list once
async function loadList() {
  if (state.loading || state.destroyed) return;
  state.loading = true;
  setStatus('Listing…');

  // show some skeletons quickly so UI feels responsive
  const skCount = Math.min(PAGE_SIZE, 6);
  const skels = [];
  for (let i = 0; i < skCount; i++) {
    const sk = createCardSkeleton();
    skels.push(sk);
    $grid.appendChild(sk);
  }

  try {
    // get JWT
    if (!state.jwt) {
      const u = netlifyIdentity.currentUser();
      if (!u) throw new Error('Not logged in');
      state.jwt = await u.jwt();
      if (!state.jwt) throw new Error('JWT not available');
    }

    const res = await fetchWithTimeout(`${API_BASE}/list`, {
      headers: { Authorization: `Bearer ${state.jwt}` },
      credentials: 'omit',
    }, 20000);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`List failed ${res.status}: ${text}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.files)) {
      throw new Error('Invalid response format');
    }

    // clear skeletons
    skels.forEach(el => el.remove());

    state.files = data.files;
    setStatus(`Loaded ${state.files.length} file(s).`);
    state.page = 0;
    $grid.innerHTML = ''; // clear before render
    renderNextPage();
  } catch (err) {
    console.error('loadList error', err);
    setStatus(`Error: ${err.message || err}`);
    // skeletons हटाओ अगर बचे हों
    skels.forEach(el => el.remove());
  } finally {
    state.loading = false;
  }
}

// Identity init (single-shot, no recursion)
function initIdentity() {
  // Important: first register handlers,
