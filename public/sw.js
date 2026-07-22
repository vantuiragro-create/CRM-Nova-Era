/* Service Worker do CRM Nova Era — permite ABRIR e VER o CRM offline (no campo,
 * sem sinal). Estrategia NETWORK-FIRST: com internet sempre traz a versao fresca
 * (nada de interface velha presa); sem internet cai no cache. NUNCA cacheia
 * POST/PATCH/DELETE (a fila offline do app cuida das escritas) nem outros dominios
 * (tiles de mapa de satelite). Bump CACHE_VER a cada deploy que precise limpar o
 * cache do shell. */
const CACHE_VER = 'nova-era-v2';
const SHELL = [
  '/', '/index.html', '/login.html', '/app.js', '/styles.css', '/manifest.json',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/brand/favicon.png', '/brand/apple-touch-icon.png',
  '/brand/icon-192.png', '/brand/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // a versao nova assume assim que instala
  e.waitUntil(caches.open(CACHE_VER).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n !== CACHE_VER).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;               // escritas: rede direta (offline vai p/ a fila do app)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiles de mapa / dominios externos: sem cache
  const ehFoto = url.pathname.startsWith('/api/foto/'); // fotos: nao cacheia (pesadas, dado privado)
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      // guarda no cache so respostas boas do proprio site (nao 401/redirect/opacas)
      if (res && res.status === 200 && res.type === 'basic' && !ehFoto) {
        const copia = res.clone();
        caches.open(CACHE_VER).then((c) => c.put(req, copia)).catch(() => {});
      }
      return res;
    } catch (_) {
      // sem rede: devolve APENAS a resposta exata em cache (sem ignoreSearch, para
      // nao servir dados de outra query/filtro/usuario)
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
