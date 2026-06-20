const CACHE_NAME = 'kchat-v2-offline';
const OFFLINE_URL = '/index.html';

// Список ресурсов для предварительного кэширования (Static Assets)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Добавляем внешние зависимости, если они грузятся через CDN (Lucide и т.д.)
  'https://unpkg.com/lucide@latest',
  'https://cdn.jsdelivr.net/npm/lucide-static@0.321.0/font/lucide.css'
];

// Установка: кэшируем статику
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Активация: чистим старые кэши
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия: Network First, falling back to Cache
// Это позволяет всегда иметь свежую версию при наличии интернета,
// но мгновенно открываться из кэша, если интернета нет.
self.addEventListener('fetch', event => {
  // Пропускаем POST запросы (API, Stealth) и WebSocket
  if (event.request.method !== 'GET' || event.request.url.includes('/stealth')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Если запрос успешен, клонируем его в кэш
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Если сеть недоступна — ищем в кэше
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Если это навигационный запрос (переход по URL) — возвращаем index.html
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
        });
      })
  );
});
