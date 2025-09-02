// upload.js (JWT debug only)
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof netlifyIdentity === "undefined") {
    console.error("Netlify Identity not loaded");
    return;
  }

  netlifyIdentity.on("init", async (u) => {
    if (!u) {
      console.warn("Not logged in");
      return;
    }
    const token = await u.jwt();
    const header = JSON.parse(atob(token.split('.')[0]));
    const payload = JSON.parse(atob(token.split('.')[1]));
    console.log("🔑 JWT Header:", header);
    console.log("📦 JWT Payload:", payload);
  });

  netlifyIdentity.init();
});
