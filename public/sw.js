const CACHE_NAME = 'screwcard-shell-v3';
const SCOPE_URL = self.registration.scope;
const SHELL_URL = new URL('./', SCOPE_URL).toString();

async function cacheUrl(cache, url) {
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) return null;
    await cache.put(url, response.clone());
    return response;
  } catch { return null; }
}

async function installCache() {
  const cache = await caches.open(CACHE_NAME);
  const shellResponse = await cacheUrl(cache, SHELL_URL);
  if (!shellResponse) return;
  const html = await shellResponse.clone().text();
  const linkedAssets = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g), (match) => match[1])
    .filter((path) => /\.(?:m?js|css)(?:[?#].*)?$/i.test(path))
    .map((path) => new URL(path, SHELL_URL).toString());

  const linkedResponses = await Promise.all(linkedAssets.map((url) => cacheUrl(cache, url)));
  const styleSheets = linkedAssets.filter((url) => url.endsWith('.css'));
  const fontAndStyleAssets = [];
  for (let index = 0; index < styleSheets.length; index += 1) {
    const response = linkedResponses[linkedAssets.indexOf(styleSheets[index])];
    if (!response) continue;
    const css = await response.clone().text();
    for (const match of css.matchAll(/url\((?:["']?)([^)"']+)(?:["']?)\)/g)) {
      const resource = match[1].trim();
      if (!/^(?:data:|https?:|\/\/)/i.test(resource)) fontAndStyleAssets.push(new URL(resource, styleSheets[index]).toString());
    }
  }
  await Promise.all(fontAndStyleAssets.map((url) => cacheUrl(cache, url)));

  try {
    const manifestUrl = new URL('./precache-assets.json', SCOPE_URL).toString();
    const response = await fetch(manifestUrl);
    if (response.ok) {
      await cache.put(manifestUrl, response.clone());
      const manifest = await response.json();
      const publicAssets = (manifest.files || []).map((path) => new URL(path, SCOPE_URL).toString());
      await Promise.all(publicAssets.map((url) => cacheUrl(cache, url)));
    }
  } catch { /* Keep shell installable even if optional asset precache fails. */ }
  await self.skipWaiting();
}

self.addEventListener('install', (event) => event.waitUntil(installCache()));
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('screwcard-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.includes('/api/')) return; // اللعب الأونلاين (SSE) لا يمر عبر الكاش أبداً
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match(SHELL_URL))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
    return response;
  })));
});
