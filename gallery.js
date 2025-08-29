// gallery.js (final, secure Bearer fetch)
document.addEventListener("DOMContentLoaded", initGallery);
const BACKEND = "https://shree-drive.onrender.com";

async function initGallery() {
  console.log("Gallery JS loaded");

  if (typeof netlifyIdentity === "undefined") {
    alert("Identity widget missing.");
    return;
  }
  await new Promise((res) => { netlifyIdentity.on("init", res); netlifyIdentity.init(); });

  let user = netlifyIdentity.currentUser();
  if (!user) {
    await new Promise((res) => {
      const onLogin = () => (netlifyIdentity.off("login", onLogin), res());
      netlifyIdentity.on("login", onLogin);
      netlifyIdentity.open("login");
    });
    user = netlifyIdentity.currentUser();
  }
  if (!user) { alert("Login failed."); return; }

  const token = await user.jwt();
  if (!token || token.length < 100) { alert("Invalid token."); return; }
  console.log("JWT length:", token.length);

  try {
    const resp = await fetch(`${BACKEND}/list`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `List failed: ${resp.status}`);

    const gallery = document.getElementById("gallery");
    const status = document.getElementById("status"); // optional
    if (gallery) gallery.innerHTML = "";

    const files = data.files || [];
    if (!files.length) {
      if (gallery) gallery.innerHTML = "<p>No files found.</p>";
      return;
    }

    for (const f of files) {
      const item = document.createElement("div");
      item.className = "gallery-item";

      if (f.mimeType?.startsWith("image/")) {
        const img = document.createElement("img");
        img.alt = f.name;
        img.loading = "lazy";
        try {
          const fileResp = await fetch(`${BACKEND}/file/${encodeURIComponent(f.id)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!fileResp.ok) throw new Error(`Fetch image failed: ${fileResp.status}`);
          const blob = await fileResp.blob();
          img.src = URL.createObjectURL(blob);
        } catch (err) {
          console.error("Image fetch error:", err);
          img.alt = `${f.name} (failed to load)`;
        }
        item.appendChild(img);

        const cap = document.createElement("div");
        cap.className = "name";
        cap.textContent = f.name;
        item.appendChild(cap);
      } else {
        const a = document.createElement("button");
        a.textContent = `Download ${f.name}`;
        a.onclick = async () => {
          const r = await fetch(`${BACKEND}/file/${encodeURIComponent(f.id)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!r.ok) return alert('Download failed: ' + r.status);
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url; link.download = f.name || "file";
          document.body.appendChild(link); link.click(); link.remove();
          URL.revokeObjectURL(url);
        };
        item.appendChild(a);
      }

      if (gallery) gallery.appendChild(item);
    }
    if (status) status.textContent = '';
  } catch (e) {
    console.error(e);
    alert("Error loading gallery: " + e.message);
  }
}

// optional refresh hook
window.refreshGallery = initGallery;
