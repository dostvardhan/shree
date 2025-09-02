<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>JWT Debug</title>
  <script src="https://identity.netlify.com/v1/netlify-identity-widget.js"></script>
</head>
<body>
  <h2>JWT Debug</h2>
  <button id="login">Login</button>
  <button id="logout">Logout</button>

  <script>
    // Init identity
    netlifyIdentity.init();

    document.getElementById("login").onclick = () => netlifyIdentity.open();
    document.getElementById("logout").onclick = () => netlifyIdentity.logout();

    netlifyIdentity.on("login", async user => {
      console.log("Logged in:", user.email);

      const token = await user.jwt();
      console.log("JWT raw:", token);

      // Split JWT
      const parts = token.split(".");
      const header = JSON.parse(atob(parts[0]));
      const payload = JSON.parse(atob(parts[1]));

      console.log("kid:", header.kid);
      console.log("iss:", payload.iss);
    });
  </script>
</body>
</html>
