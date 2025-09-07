// auth-init.js
(async function(){
// Lazy-load auth0-spa-js if not present
if(!window.createAuth0Client) {
// If you keep a local copy, serve /lib/auth0-spa-js.production.js and change path here
const s = document.createElement('script');
s.src = '/lib/auth0-spa-js.production.js';
document.head.appendChild(s);
await new Promise(r => s.onload = r);
}


const auth0Config = {
domain: 'dev-zzhjbmtzoxtgoz31.us.auth0.com',
client_id: '0glcwUr7ZZ9sbBTBPiUPahEqqwUcuzfR',
audience: 'https://shree-drive.onrender.com',
cacheLocation: 'localstorage',
useRefreshTokens: true
};


let auth0Client = null;


async function init() {
if(auth0Client) return auth0Client;
auth0Client = await createAuth0Client(auth0Config);


// handle redirect callback (Auth0 code & state in URL)
if(window.location.search.includes('code=') && window.location.search.includes('state=')){
try {
await auth0Client.handleRedirectCallback();
} catch(e){ console.warn('redirect callback error', e); }
// redirect to life.html as default
window.location.replace(window.location.origin + '/life.html');
}
return auth0Client;
}


async function auth0Login(){
const client = await init();
return client.loginWithRedirect({ redirect_uri: window.location.origin + '/life.html', scope: 'openid profile email' });
}


async function getToken(){
const client = await init();
const isAuth = await client.isAuthenticated();
if(!isAuth) return null;
return await client.getTokenSilently();
}


async function isAuthenticated(){
const client = await init();
return client.isAuthenticated();
}


async function auth0Logout(){
const client = await init();
client.logout({ returnTo: window.location.origin + '/' });
}


window.initAuth0 = init;
window.auth0Login = auth0Login;
window.getToken = getToken;
window.isAuthenticated = isAuthenticated;
})();
