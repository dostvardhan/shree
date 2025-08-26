// upload.js
// Netlify Identity + Google Drive uploader (Render backend)
// Author: you 🫶

const API_BASE = "https://shree-drive.onrender.com"; // backend base URL

function qs(sel) { return document.querySelector(sel); }

function setStatus(msg) {
  const box = qs("#uploadStatus");
  if (box) box.textContent = msg;
}

async function ensureIdentityReady() {
  if (!window.netlifyIdentity) {
    throw new Error("Netlify Identity widget not loaded. Add its script tag.");
  }
  try { window.netlifyIdentity.init(); } catch (_) {}
}

async function getTokenOrLogin() {
  await ensureIdentityReady();
  let user = window.netlifyIdentity.currentUser();
  if (user) return user.jwt();

  // Not logged in → open login modal and wait for login
  return new Promise((resolve, reject) => {
    const onLogin = async (u) => {
      try {
        const t = await u.jwt();
        window.netlifyIdentity.off("login", onLogin);
        resolve(t);
      } catch (e) { reject(e); }
    };
    window.netlifyIdentity.on("login", onLogin);
    window.netlifyIdentity.open("login");
  });
}

function validateFile(file, { maxMB = 25, accept = ["image/"] } = {}) {
  if (!file) return "Please choose a file.";
  const okType = accept.some(a => file.type.startsWith(a));
  if (!okType) return `Unsupported type (${file.type}). Please upload an image.`;
  const maxBytes = maxMB * 1024 * 1024;
  if (file.size > maxBytes) return `File too large. Max ${maxMB} MB allowed.`;
  return null;
}

async function uploadWithProgress({ file, token, onProgress }) {
  const form = new FormData();
  form.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    if (xhr.upload && typeof onProgress === "function") {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct);
        }
      };
    }

    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch (_e) {}
      if (xhr.status >= 200 && xhr.status < 300 && !data.error) {
        resolve(data);
      } else {
        reject(new Error(data.error || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}

async function handleUploadClick() {
  const fileInput = qs("#fileInput");
  const file = fileInput?.files?.[0];
  const validation = validateFile(file);
  if (validation) return setStatus(validation);

  try {
    const token = await getTokenOrLogin();
    setStatus("Uploading… 0%");
    const data = await uploadWithProgress({
      file,
      token,
      onProgress: (pct) => setStatus(`Uploading… ${pct}%`)
    });
    setStatus(`✅ Upload success\n${JSON.stringify(data, null, 2)}`);
  } catch (e) {
    setStatus(`❌ Upload failed\n${e.message}`);
  }
}

// Auto-wire the button if present
document.addEventListener("DOMContentLoaded", () => {
  const btn = qs("#uploadBtn");
  if (btn) btn.addEventListener("click", handleUploadClick);
});

// Expose for inline onclick fallback (optional)
window.uploadFile = handleUploadClick;
