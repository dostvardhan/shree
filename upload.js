// upload.js (final)

document.addEventListener("DOMContentLoaded", initUpload);

const BACKEND = "https://shree-drive.onrender.com"; // change only if needed

async function initUpload() {
  const fileInput = document.getElementById("file");
  const btn = document.getElementById("uploadBtn");
  const out = document.getElementById("output");

  if (!fileInput || !btn || !out) {
    console.warn("Upload UI elements missing (#file, #uploadBtn, #output).");
    return;
  }

  // Netlify Identity must be loaded
  if (typeof netlifyIdentity === "undefined") {
    alert("Identity widget missing. Add <script src='https://identity.netlify.com/v1/netlify-identity-widget.js'></script>");
    return;
  }

  // Init Identity and ensure login
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
    if (!u) throw new Error("Login failed. Refresh and try again.");
    return u;
  }

  async function getFreshToken() {
    const u = await ensureLoggedIn();
    const t = await u.jwt();               // MUST be jwt(), not access_token
    if (!t || t.length < 100) throw new Error("Invalid token from Netlify Identity");
    return t;
  }

  async function uploadFile(file) {
    const token = await getFreshToken();   // get fresh token at click time
    const fd = new FormData();
    fd.append("file", file);

    const r = await fetch(`${BACKEND}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });

    // Try to parse JSON; if fails, read text for better error
    let data;
    try { data = await r.json(); } catch {
      const txt = await r.text().catch(() => "");
      throw new Error(`Upload failed: ${r.status} ${txt || r.statusText}`);
    }
    if (!r.ok || !data.ok) throw new Error(data?.error || `Upload failed: ${r.status}`);
    return data;
  }

  btn.addEventListener("click", async () => {
    if (!fileInput.files?.length) {
      out.textContent = "Choose a file first.";
      return;
    }

    btn.disabled = true;
    out.textContent = "Uploading…";

    try {
      const res = await uploadFile(fileInput.files[0]);
      out.textContent = "Uploaded ✅ " + (res.file?.name || res.file?.id || "");
      console.log("UPLOAD:", res);
    } catch (e) {
      console.error(e);
      out.textContent = "Error: " + e.message +
        (e.message.includes("issuer") ? " (Token mismatch? Re-login once.)" : "");
    } finally {
      btn.disabled = false;
    }
  });

  // Optional: debug helper (run from console)
  window.whoami = async () => {
    const t = await getFreshToken();
    const r = await fetch(`${BACKEND}/whoami`, { headers: { Authorization: `Bearer ${t}` } });
    try { return await r.json(); } catch { return { ok: false, status: r.status }; }
  };
}
