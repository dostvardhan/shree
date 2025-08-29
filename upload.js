// upload.js (final)
document.addEventListener("DOMContentLoaded", initUpload);
const BACKEND = "https://shree-drive.onrender.com";

async function initUpload() {
  const fileInput = document.getElementById("file");
  const btn = document.getElementById("uploadBtn");
  const out = document.getElementById("output");

  if (!fileInput || !btn || !out) return;

  if (typeof netlifyIdentity === "undefined") {
    alert("Identity widget missing.");
    return;
  }

  await new Promise((res) => { netlifyIdentity.on("init", res); netlifyIdentity.init(); });

  async function ensureLoggedIn() {
    let u = netlifyIdentity.currentUser();
    if (!u) {
      await new Promise((res) => {
        const onLogin = () => (netlifyIdentity.off("login", onLogin), res());
        netlifyIdentity.on("login", onLogin);
        netlifyIdentity.open("login");
      });
      u = netlifyIdentity.currentUser();
    }
    if (!u) throw new Error("Login failed.");
    return u;
  }

  async function getFreshToken() {
    const u = await ensureLoggedIn();
    const t = await u.jwt();
    if (!t || t.length < 100) throw new Error("Invalid Identity token");
    return t;
  }

  async function uploadFile(file) {
    const token = await getFreshToken();
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${BACKEND}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });
    let data;
    try { data = await r.json(); } catch { throw new Error(`Upload failed: ${r.status}`); }
    if (!r.ok || !data.ok) throw new Error(data?.error || `Upload failed: ${r.status}`);
    return data;
  }

  btn.addEventListener("click", async () => {
    if (!fileInput.files?.length) { out.textContent = "Choose a file first."; return; }
    btn.disabled = true; out.textContent = "Uploading…";
    try {
      const res = await uploadFile(fileInput.files[0]);
      out.textContent = "Uploaded ✅ " + (res.file?.name || res.file?.id || "");
      console.log("UPLOAD:", res);
    } catch (e) {
      console.error(e);
      out.textContent = "Error: " + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Optional debug
  window.whoami = async () => {
    const t = await getFreshToken();
    const r = await fetch(`${BACKEND}/whoami`, { headers: { Authorization: `Bearer ${t}` } });
    try { return await r.json(); } catch { return { ok: false, status: r.status }; }
  };
}
