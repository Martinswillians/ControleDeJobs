// ═══════════════════════════════════════════════
// Service Worker — Controle de Job
// ═══════════════════════════════════════════════

const CACHE_NAME = "jobcontrol-v2";

// Caminhos relativos — funcionam tanto na raiz quanto em subpastas (ex: GitHub Pages)
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/firebase-config.js",
  "./js/clients.js",
  "./js/access.js",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(err => console.warn("SW cache install warning:", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // Não interceptar chamadas ao Firebase — sempre direto na rede
  if (e.request.url.includes("firebase") ||
      e.request.url.includes("googleapis") ||
      e.request.url.includes("gstatic")) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).catch(() => {
        // Fallback para index.html em caso de offline + navegação
        if (e.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});
