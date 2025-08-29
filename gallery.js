// gallery.js (final)

document.addEventListener("DOMContentLoaded", initGallery);

const BACKEND = "https://shree-drive.onrender.com"; // change only if needed

async function initGallery() {
  console.log("Gallery JS loaded");

  // 1) Ensure Netlify Identity
  if (typeof netlifyIdentity === "undefined") {
    alert("Identity widget missing. Add <script src='https://identity.netlify.com/v1/netlify-identity-widget.js'></script>");
    return;
  }
  await new Promise((res) => {
    netlifyIdentity.on("init", res);
    netlifyIdentity.init();
  });

  // 2) Ensure login
  let user = netlifyIdentity.currentUser();
  if (!user) {
    console.log("Opening login…");
    await new Promise((res) => {
      const onLogin = () => (netlifyIdentity.off("login", onLogin), res());
      netlifyIdentity.on("login", onLogin);
      netlifyIdentity.open("login");
    });
    user = netlifyIdentity.currentUser();
  }
  if (!user) {
    alert("Login failed. Refresh and try again.");
    return;
  }

  // 3) Get JWT
  const token = await user.jwt();
  if (!token || token.length < 100) {
    alert("Invalid token from Netlify Identity.");
    return;
  }
  console.log("JWT length:", token.length);

  // 4) Load & render list
  try {
    console.log("Listing…");
    const resp = await fetch(`${BACKEND}/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    console.log("LIST:", data);
    if (!resp.ok || !data.ok) throw new Error(data.error || `List failed: ${resp.status}`);

    const gallery = document.getElementById("gallery");
    if (!gallery) return console.warn("#gallery not found");
    gallery.innerHTML = "";

    const files = data.files || [];
    if (!files.length) {
      gallery.innerHTML = "<p>No files found.</p>";
      return;
    }

    // 5) Render items
    for (const f of files) {
      const item = document.createElement("div");
      item.className = "gallery-item";
      item.style.display = "inline-block";
      item.style.margin = "8px";
      item.style.textAlign = "center";

      if (f.mimeType?.startsWith("image/")) {
        // SECURE IMAGE FETCH via Bearer header -> blob -> objectURL
        const img = document.createElement("img");
        img.alt = f.name;
        img.loading = "lazy";
        img.style.maxWidth = "220px";
        img.style.maxHeight = "220px";
        img.style.display = "block";

        try {
          const fileResp = await fetch(`${BACKEND}/file/${encodeURIComponent(f.id)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!fileResp.ok) throw new Error(`Fetch image failed: ${fileResp.status}`);
          const blob = await fileResp.blob();
          img.src = URL.createObjectURL(blob);
        } catch (err) {
          console.error("Image fetch error:", err);
          // OPTIONAL FALLBACK (if your backend supports ?auth=)
          // img.src = `${BACKEND}/file/${encodeURIComponent(f.id)}?auth=${encodeURIComponent(token)}`;
          img.alt = `${f.name} (failed to load)`;
        }

        item.appendChild(img);
        const cap = document.createElement("div");
        cap.textContent = f.name;
        cap.style.fontSize = "12px";
        cap.style.marginTop = "4px";
        item.appendChild(cap);
      } else {
        // Non-image: show a secure download button
        const btn = document.createElement("button");
        btn.textContent = `Download ${f.name}`;
        btn.onclick = async () => {
          try {
            const r = await fetch(`${BACKEND}/file/${encodeURIComponent(f.id)}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (!r.ok) throw new Error(`Download failed: ${r.status}`);
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = f.name || "file";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } catch (e) {
            alert(e.message);
          }
        };
        item.appendChild(btn);
      }

      gallery.appendChild(item);
    }
  } catch (e) {
    console.error(e);
    alert("Error loading gallery: " + e.message);
  }
}

// Optional debug helpers (run in console)
window.whoami = async () => {
  const u = netlifyIdentity.currentUser();
  if (!u) return { ok: false, error: "Not logged in" };
  const t = await u.jwt();
  const r = await fetch(`${BACKEND}/whoami`, { headers: { Authorization: `Bearer ${t}` } });
  return r.json();
};
