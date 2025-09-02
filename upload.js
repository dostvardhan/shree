// upload.js (debug version)
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
      const u = netlifyIdentity.currentUser();
      if (!u) {
        alert("You must be logged in");
        return;
      }

      const token = await u.jwt();

      // 🔎 DEBUG: print JWT header + payload
      const header = JSON.parse(atob(token.split('.')[0]));
      const payload = JSON.parse(atob(token.split('.')[1]));
      console.log("🔑 JWT Header:", header);
      console.log("📦 JWT Payload:", payload);

      const fd = new FormData();
      fd.append("file", f);
      fd.append("quote", document.getElementById("quote")?.value || "");

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
