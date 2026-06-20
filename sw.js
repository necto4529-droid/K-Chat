const CACHE_NAME = 'kchat-v2';

// Ресурсы для предварительного кеширования (App Shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/script.js',
  '/stickers.js',
  '/lucide-icons.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Внешние зависимости (CDN) тоже можно кешировать
  'https://cdn.jsdelivr.net/npm/argon2-browser@1.18.0/dist/argon2-bundled.min.js',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;600;700;800&display=swap'
];

// Установка: кешируем статику
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация: чистим старые кеши
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват запросов
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Не кешируем API запросы (WebSocket и Stealth-метрики)
  if (url.pathname.includes('/api/') || url.pathname.includes('/socket.io')) {
    return;
  }

  // Стратегия: Cache First, then Network (для статики)
  // Это гарантирует, что приложение откроется мгновенно даже без сети
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Возвращаем из кеша, но параллельно обновляем кеш из сети (Stale-While-Revalidate)
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
            }
          }).catch(() => {}); // Игнорируем ошибки сети при фоновом обновлении
          
          return cachedResponse;
        }

        // Если нет в кеше — идем в сеть
        return fetch(event.request).then(networkResponse => {
          // Кешируем новые ресурсы на лету (например, картинки или новые иконки)
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        }).catch(() => {
          // Если сеть упала и ресурса нет в кеше — для HTML возвращаем корень (офлайн-режим)
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
  );
});
