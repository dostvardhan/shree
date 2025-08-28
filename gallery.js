// gallery.js
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Gallery JS loaded");

  // Init Netlify Identity
  if (typeof netlifyIdentity === "undefined") {
    alert("Identity widget missing. Please check <script> tag in HTML.");
    return;
  }

  await new Promise((resolve) => {
    netlifyIdentity.on("init", resolve);
    netlifyIdentity.init();
  });

  let user = netlifyIdentity.currentUser();
  if (!user) {
    console.log("No user logged in, opening login popup...");
    await new Promise((res) => {
      netlifyIdentity.on("login", res);
      netlifyIdentity.open("login");
    });
    user = netlifyIdentity.currentUser();
  }

  if (!user) {
    alert("Login failed. Please refresh and try again.");
    return;
  }

  console.log("Logged in as:", user.email);

  // Get fresh JWT
  const token = await user.jwt();
  console.log("JWT length:", token.length);

  // Fetch file list from backend
  try {
    console.log("Listing files...");
    const resp = await fetch("https://shree-drive.onrender.com/list", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await resp.json();
    console.log("LIST response:", data);

    if (!data.ok) {
      throw new Error(data.error || "Failed to fetch list");
    }

    const gallery = document.getElementById("gallery");
    gallery.innerHTML = "";

    if (!data.files || data.files.length === 0) {
      gallery.innerHTML = "<p>No files found.</p>";
      return;
    }

    data.files.forEach((f) => {
      const item = document.createElement("div");
      item.className = "gallery-item";

      if (f.mimeType && f.mimeType.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = f.thumbnailLink || f.webContentLink || "";
        img.alt = f.name;
        item.appendChild(img);
      } else {
        const link = document.createElement("a");
        link.href = f.webViewLink;
        link.target = "_blank";
        link.textContent = f.name;
        item.appendChild(link);
      }

      gallery.appendChild(item);
    });
  } catch (err) {
    console.error("Error fetching gallery:", err);
    alert("Error loading gallery: " + err.message);
  }
});
