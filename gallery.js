// gallery.js
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Gallery JS loaded");

  if (typeof netlifyIdentity === "undefined") {
    alert("Identity widget missing. Fix the <script> tag.");
    return;
  }

  await new Promise((res) => { netlifyIdentity.on("init", res); netlifyIdentity.init(); });

  let user = netlifyIdentity.currentUser();
  if (!user) {
    console.log("Opening login…");
    await new Promise((res) => { netlifyIdentity.on("login", res); netlifyIdentity.open("login"); });
    user = netlifyIdentity.currentUser();
  }
  if (!user) { alert("Login failed. Refresh and try again."); return; }

  const token = await user.jwt();
  console.log("JWT length:", token.length);

  try {
    console.log("Listing…");
    const resp = await fetch("https://shree-drive.onrender.com/list", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    console.log("LIST:", data);
    if (!data.ok) throw new Error(data.error || "List failed");

    const gallery = document.getElementById("gallery");
    gallery.innerHTML = "";

    if (!data.files?.length) {
      gallery.innerHTML = "<p>No files found.</p>";
      return;
    }

    data.files.forEach((f) => {
      const item = document.createElement("div");
      item.className = "gallery-item";
      if (f.mimeType?.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = f.thumbnailLink || f.webContentLink || "";
        img.alt = f.name;
        item.appendChild(img);
      } else {
        const a = document.createElement("a");
        a.href = f.webViewLink; a.target = "_blank"; a.textContent = f.name;
        item.appendChild(a);
      }
      gallery.appendChild(item);
    });
  } catch (e) {
    console.error(e);
    alert("Error loading gallery: " + e.message);
  }
});
