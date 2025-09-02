// gallery.js (debug version)
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

  // 🔎 DEBUG: print JWT header + payload
  const header = JSON.parse(atob(token.split('.')[0]));
  const payload = JSON.parse(atob(token.split('.')[1]));
  console.log("🔑 JWT Header:", header);
  console.log("📦 JWT Payload:", payload);

  if (!token || token.length < 100) { alert("Invalid token."); return; }
  console.log("JWT length:", token.length);

  try {
    const resp = await fetch(`${BACKEND}/list`, { headers: { Authorization: `Bearer ${token}` } });
    const files = await resp.json();
    console.log("📂 List response:", files);

    const gallery = document.getElementById("gallery");
    if (gallery) gallery.innerHTML = "";

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

        if (f.description) {
          const cap = document.createElement("div");
          cap.className = "quote";
          cap.textContent = f.description;
          item.appendChild(cap);
        }
      }

      if (gallery) gallery.appendChild(item);
    }
  } catch (e) {
    console.error(e);
    alert("Error loading gallery: " + e.message);
  }
}

window.refreshGallery = initGallery;
