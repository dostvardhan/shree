// upload.js
document.addEventListener("DOMContentLoaded", async () => {
  const fileInput = document.getElementById("file");
  const btn = document.getElementById("uploadBtn");
  const out = document.getElementById("output");

  if (typeof netlifyIdentity === "undefined") {
    alert("Identity widget missing. Fix the <script> tag.");
    return;
  }

  await new Promise((res) => { netlifyIdentity.on("init", res); netlifyIdentity.init(); });
  let user = netlifyIdentity.currentUser();
  if (!user) { netlifyIdentity.open("login"); await new Promise((res) => netlifyIdentity.on("login", res)); user = netlifyIdentity.currentUser(); }
  if (!user) { alert("Login failed."); return; }

  const token = await user.jwt();

  btn.addEventListener("click", async () => {
    if (!fileInput.files?.length) { out.textContent = "Choose a file first."; return; }
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);

    btn.disabled = true; out.textContent = "Uploading…";
    try {
      const r = await fetch("https://shree-drive.onrender.com/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const data = await r.json();
      console.log("UPLOAD:", data);
      if (!data.ok) throw new Error(data.error || "Upload failed");
      out.textContent = "Uploaded: " + (data.file?.name || data.file?.id);
    } catch (e) {
      out.textContent = "Error: " + e.message;
    } finally {
      btn.disabled = false;
    }
  });
});
