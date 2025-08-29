// upload.js

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("file");
  const btn = document.getElementById("uploadBtn");
  const out = document.getElementById("output");

  btn.addEventListener("click", async () => {
    const f = fileInput.files[0];
    if (!f) {
      alert("Choose a file first!");
      return;
    }

    try {
      // Get Netlify Identity current user
      const u = netlifyIdentity.currentUser();
      if (!u) {
        alert("You must be logged in");
        return;
      }

      // Get JWT token from Identity
      const token = await u.jwt();

      // Prepare file data
      const fd = new FormData();
      fd.append("file", f);

      // Call backend (Render) API
      const res = await fetch("https://shree-drive.onrender.com/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });

      const j = await res.json();
      if (j.ok) {
        out.textContent = "✅ Uploaded: " + (j.file?.name || f.name);
      } else {
        out.textContent = "❌ Error: " + (j.error || "Upload failed");
      }
    } catch (e) {
      out.textContent = "❌ Exception: " + e.message;
    }
  });
});
