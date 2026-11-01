// Aeneis — service worker: app y texto sin conexión (el audio guardado vive en 'aen-audio-v1').
const CACHE = 'aen-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data/aeneis.json', 'manifest.webmanifest',
  'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'fonts/fonts.css',
  'fonts/Cinzel-500.woff2', 'fonts/EBGaramond-400.woff2', 'fonts/EBGaramond-400i.woff2', 'fonts/UncialAntiqua-400.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('aen-shell') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // el audio remoto pasa directo
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
