// gallery.js — Private gallery logic

async function pickIssuer() {
  const variants = [
    window.location.origin,
    window.location.origin.replace('https://', 'https://www.'),
    window.location.origin.replace('https://www.', 'https://'),
    // 'https://<yoursite>.netlify.app'
  ];
  for (const o of variants) {
    try {
      const url = o.replace(/\/+$/, '') + '/.netlify/identity/.well-known/jwks.json';
      const r = await fetch(url, { method: 'GET', mode: 'cors' });
      if (r.status === 200) return o.replace(/\/+$/, '') + '/.netlify/identity';
    } catch (_) {}
  }
  return window.location.origin.replace(/\/+$/, '') + '/.netlify/identity';
}

let CURRENT_ISSUER = null;

async function getJWT(){
  const u = netlifyIdentity.currentUser();
  if (!u) throw new Error('NO_USER');
  return await u.jwt();
}

async function api(path, opts = {}) {
  if (!CURRENT_ISSUER) CURRENT_ISSUER = await pickIssuer();
  const t = await getJWT();
  const headers = Object.assign(
    {
      Authorization: `Bearer ${t}`,
      'X-NI-Issuer': CURRENT_ISSUER
    },
    opts.headers || {}
  );
  return fetch(`https://shree-drive.onrender.com${path}`, { ...opts, headers });
}

const statusEl = document.getElementById('status');
const grid = document.getElementById('grid');

async function loadGallery(){
  statusEl.textContent = 'Loading gallery…';
  const r = await api('/list');
  const data = await r.json();
  if (!data.ok) throw new Error('LIST_FAIL: ' + (data.error || 'unknown'));

  grid.innerHTML = '';
  (data.files || []).forEach(f => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = f.name || f.id;
    img.src = `https://shree-drive.onrender.com/file/${f.id}`;
    grid.appendChild(img);
  });

  statusEl.textContent = (data.files && data.files.length)
    ? `Loaded ${data.files.length} images`
    : 'No images yet — upload one!';
}

async function uploadOne(file){
  const fd = new FormData();
  fd.append('file', file);
  const r = await api('/upload', { method:'POST', body: fd });
  const data = await r.json();
  if (!data.ok) throw new Error('UPLOAD_FAIL: ' + (data.error || 'unknown'));
  return data.file;
}

document.getElementById('uploadBtn').addEventListener('click', async () => {
  const f = document.getElementById('file').files[0];
  if (!f) return alert('Pick a file first');
  try {
    statusEl.textContent = 'Uploading…';
    await uploadOne(f);
    await loadGallery();
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Upload failed';
    alert('Upload failed: ' + e.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  netlifyIdentity.logout();
});

netlifyIdentity.on('init', async (user) => {
  if (!user) {
    netlifyIdentity.open('login');
  } else {
    try {
      CURRENT_ISSUER = await pickIssuer();
      await loadGallery();
    } catch (e) {
      console.error(e);
      statusEl.textContent = 'Error: ' + e.message;
    }
  }
});
netlifyIdentity.on('login', () => location.reload());
netlifyIdentity.on('logout', () => location.reload());
netlifyIdentity.init();
