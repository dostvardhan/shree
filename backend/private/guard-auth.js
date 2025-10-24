<script>
window.requireAuth = async function requireAuth() {
  // getAuth0() तुम्‍हारे auth-init.js से आता है
  const auth0 = await window.getAuth0();

  // अगर Auth0 ने अभी-अभी redirect callback किया है तो URL साफ़ कर दो
  if (location.search.includes('code=') && location.search.includes('state=')) {
    try { await auth0.handleRedirectCallback(); } catch(e) {}
    history.replaceState({}, document.title, location.pathname);
  }

  // back/forward cache से आये हैं तो hard reload कराओ (ताकि guard चले)
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && (nav.type === 'back_forward')) {
      location.replace(location.href);
      await new Promise(()=>{}); // आगे का code न चले
    }
  } catch(e){}

  // Auth check
  const ok = await auth0.isAuthenticated();
  if (ok) return await auth0.getUser();

  // Not authed → उसी page पर वापस आने वाला redirect
  await auth0.loginWithRedirect({
    authorizationParams: { redirect_uri: location.href }
  });

  throw new Error('redirecting');
};
</script>
