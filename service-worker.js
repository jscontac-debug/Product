/**
 * service-worker.js
 * -----------------------------------------------------------------------
 * Habilita el funcionamiento offline de Product (PWA).
 * Estrategia: cache-first para los recursos de la aplicacion, con
 * actualizacion en segundo plano ("stale-while-revalidate" ligero).
 * -----------------------------------------------------------------------
 */

const CACHE_NAME = 'product-cache-v1';

const ARCHIVOS_APP = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './modules/dashboard.js',
  './modules/tienda.js',
  './modules/personal.js',
  './modules/cobertura.js',
  './modules/operaciones.js',
  './modules/reglas.js',
  './modules/motor.js',
  './modules/validacion.js',
  './modules/informes.js',
  './modules/storage.js',
  './data/demo.json'
];

// Instalacion: precachear todos los archivos de la aplicacion.
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ARCHIVOS_APP))
      .then(() => self.skipWaiting())
  );
});

// Activacion: eliminar caches antiguas de versiones previas.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((claves) => Promise.all(
      claves
        .filter((clave) => clave !== CACHE_NAME)
        .map((clave) => caches.delete(clave))
    )).then(() => self.clients.claim())
  );
});

// Peticiones: cache-first, con fallback a red y actualizacion de cache.
self.addEventListener('fetch', (evento) => {
  if (evento.request.method !== 'GET') return;

  evento.respondWith(
    caches.match(evento.request).then((respuestaCache) => {
      const fetchPromise = fetch(evento.request)
        .then((respuestaRed) => {
          if (respuestaRed && respuestaRed.status === 200) {
            const copia = respuestaRed.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(evento.request, copia));
          }
          return respuestaRed;
        })
        .catch(() => respuestaCache);

      return respuestaCache || fetchPromise;
    })
  );
});
