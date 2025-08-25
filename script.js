/* =========================================================================
   Netlify Identity: Site-wide guard + Backend auth helper
   Lock: Entire site (except /login.html) — works with _redirects rules.
   Repo usage:
   1) Include in <head> of ALL protected pages (index.html, life.html, etc.)
   2) Keep _redirects in repo root (or /public) as configured.
   3) Add login.html at repo root (already provided).
   ========================================================================= */

(() => {
  // ====== CONFIG ======
  // Frontend site origin (used for issuer check & CORS hints if needed)
  const SITE_ORIGIN = 'https://shreshthapushkar.com';

  // Your backend (Render) origin for uploader/list/listing endpoints
  const BACKEND_ORIGIN = 'https://shree-drive.onrender.com';

  // Pages that do NOT require auth (keep login page open)
  const OPEN_PATHS = new Set(['/login.html', '/401.html', '/.netlify/functions/*']);

  // ====== SMALL UTILS ======
  function isOpenPath(pathname) {
    if (OPEN_PATHS.has(pathname)) return true;
    // allow Netlify internal paths
    if (pathname.startsWith('/.netlify/')) return true;
    return false;
  }

  function rememberNext() {
    try {
      sessionStorage.setItem('next', window.location.pathname + window.location.search);
    } catch (_) {}
  }

  function consumeNextOrHome() {
    let next = '/';
    try {
      next = sessionStorage.getItem('next') || '/';
      sessionStorage.removeItem('next');
    } catch (_) {}
    return next;
  }

  function goLogin() {
    rememberNext();
    window.location.replace('/login.html');
  }

  // ====== CORE GUARD (client-side UX; server-side lock is via _redirects) ======
  if (!isOpenPath(window.location.pathname)) {
    document.addEventListener('DOMContentLoaded', () => {
      // If widget isn't present for some reason, bounce to login.
      if (!window.netlifyIdentity) return goLogin();

      // Initialize identity and gate access
      netlifyIdentity.on('init', (user) => {
        if (!user) return goLogin();
      });

      // On logout anywhere, go to login
      netlifyIdentity.on('logout', () => {
        goLogin();
      });

      // On login (if user arrived directly on a page), go where they intended
      netlifyIdentity.on('login', () => {
        const dest = consumeNextOrHome();
        window.location.replace(dest);
      });

      // Actually initialize
      netlifyIdentity.init();
    });
  } else {
    // On the login page: if already logged in, send user back to the intended page.
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.netlifyIdentity) return; // widget loads on login page
      netlifyIdentity.on('init', (user) => {
        if (user) {
          const dest = consumeNextOrHome();
          if (window.location.pathname !== dest) {
            window.location.replace(dest);
          }
        }
      });
      netlifyIdentity.init();
    });
  }

  // ====== AUTH FETCH HELPER (frontend -> backend with Identity JWT) ======
  /**
   * authFetch(url, options)
   * - Automatically attaches Netlify Identity JWT in Authorization header.
   * - Ensures user is logged in; otherwise sends them to /login.html.
   * Usage:
   *   const res = await authFetch(`${BACKEND_ORIGIN}/list`);
   *   const data = await res.json();
   */
  async function authFetch(url, options = {}) {
    const ni = window.netlifyIdentity;
    if (!ni) {
      goLogin();
      return Promise.reject(new Error('Netlify Identity not available'));
    }
    const user = ni.currentUser();
    if (!user) {
      goLogin();
      return Promise.reject(new Error('Not authenticated'));
    }
    const token = await user.jwt(); // RS256 JWT from Netlify Identity

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);

    // Avoid sending cookies to backend (we rely on JWT only)
    const fetchOpts = {
      ...options,
      headers,
      credentials: 'omit',
      mode: 'cors',
    };

    return fetch(url, fetchOpts);
  }

  // Expose helpers to window for easy use in inline scripts
  window.__AUTH__ = {
    authFetch,
    BACKEND_ORIGIN,
    SITE_ORIGIN,
  };

  // ====== OPTIONAL: HOOK UP COMMON PAGES (upload.html, gallery.html) ======

  /**
   * If you want zero-code in HTML, uncomment the blocks below and
   * make sure your HTML uses the same element IDs.
   *
   * --- upload.html ---
   * <form id="uploadForm">
   *   <input type="file" id="file" name="file" required />
   *   <button type="submit">Upload</button>
   * </form>
   */
  document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
      uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const fileInput = document.getElementById('file');
          if (!fileInput || !fileInput.files || !fileInput.files[0]) {
            alert('Select a file first');
            return;
          }
          const fd = new FormData();
          fd.append('file', fileInput.files[0]);
          const res = await authFetch(`${BACKEND_ORIGIN}/upload`, {
            method: 'POST',
            body: fd,
          });
          const data = await res.json();
          if (!res.ok || data.error) {
            alert(`Upload failed: ${data.error || res.status}`);
          } else {
            alert('Uploaded ✅');
            // optionally refresh a list
          }
        } catch (err) {
          console.error(err);
          alert('Upload error');
        }
      });
    }

    /**
     * --- gallery.html (or any page that lists files) ---
     * <div id="fileList"></div>
     */
    const fileList = document.getElementById('fileList');
    if (fileList) {
      (async () => {
        try {
          const res = await authFetch(`${BACKEND_ORIGIN}/list`);
          if (!res.ok) throw new Error(`List failed: ${res.status}`);
          const payload = await res.json();
          const files = payload.files || [];
          fileList.innerHTML = files.map((f) => {
            // Example viewer endpoint (server should check JWT again):
            // GET `${BACKEND_ORIGIN}/file/:id`
            const viewHref = `${BACKEND_ORIGIN}/file/${encodeURIComponent(f.id)}`;
            const size = f.size ? ` (${Number(f.size).toLocaleString()} bytes)` : '';
            return `<div><a href="${viewHref}" target="_blank" rel="noreferrer noopener">${f.name}</a>${size}</div>`;
          }).join('') || '<em>No files</em>';
        } catch (e) {
          console.error(e);
          fileList.innerHTML = '<em>Failed to load files</em>';
        }
      })();
    }
  });

})();
