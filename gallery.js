// gallery.js (Auth0-ready)
document.addEventListener("DOMContentLoaded", initGallery);
const BACKEND = "https://shree-drive.onrender.com";

async function initGallery() {
  console.log("Gallery JS loaded (auth0 version)");

  if (!window.__AUTH__) {
    alert("Auth helper missing. Include guard-auth-auth0.js first.");
    return;
  }

  try {
    // ensure client inicialized
    await window.__AUTH__.init();
  } catch (e) {
    console.error("Auth init failed:", e);
    alert("Auth init failed: " + (e.message || e));
    return;
  }

  try {
    const resp = await window.__AUTH__.authFetch(`${BACKEND}/list`);
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({ error: resp.status }));
      console.error("List fetch failed:", resp.status, err);
      document.getElementById("gallery").innerText = "❌ " + (err.error || resp.status);
      return;
    }
    const data = await resp.json();
    const files = data.files || [];
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
          const fileResp = await window.__AUTH__.authFetch(`${BACKEND}/file/${encodeURIComponent(f.id)}`);
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
