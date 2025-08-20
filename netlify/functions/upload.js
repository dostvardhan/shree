document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("upload-form");
  const fileInput = document.getElementById("file-input");
  const captionInput = document.getElementById("caption");
  const statusEl = document.getElementById("status");
  const postsContainer = document.getElementById("posts-container");

  // 🔹 Load saved posts from Netlify Blob
  async function loadPosts() {
    postsContainer.innerHTML = "Loading posts...";
    try {
      const res = await fetch("/.netlify/functions/getPosts");
      const posts = await res.json();

      postsContainer.innerHTML = "";
      posts.reverse().forEach((post) => {
        const div = document.createElement("div");
        div.className = "post";
        div.innerHTML = `
          <img src="${post.imageUrl}" alt="Nadaniya post" />
          <p>${post.caption}</p>
        `;
        postsContainer.appendChild(div);
      });
    } catch (err) {
      postsContainer.innerHTML = "Error loading posts.";
      console.error(err);
    }
  }

  loadPosts();

  // 🔹 Handle upload
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!fileInput.files.length) {
      alert("Pehle photo select karo!");
      return;
    }

    const file = fileInput.files[0];
    const caption = captionInput.value.trim();

    statusEl.textContent = "Uploading...";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("caption", caption);

    try {
      const res = await fetch("/.netlify/functions/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      statusEl.textContent = "Upload successful! 🎉";

      // reload posts
      loadPosts();

      // clear form
      fileInput.value = "";
      captionInput.value = "";
    } catch (err) {
      statusEl.textContent = "Error uploading post.";
      console.error(err);
    }
  });
});
