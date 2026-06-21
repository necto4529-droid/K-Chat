/* ================================================================
   K-Chat Service Worker  —  v3
   Стратегия: Cache-First для App Shell + Stale-While-Revalidate
   Гарантирует запуск приложения без интернета после первого визита
   ================================================================ */

const CACHE_NAME = 'kchat-v3.2';

// Ресурсы App Shell — кешируются при установке SW
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/script.js',
  './stickers.js',
  './lucide-icons.js',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// CDN-ресурсы кешируем отдельно (не блокируем установку при недоступности CDN)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/argon2-browser@1.18.0/dist/argon2-bundled.min.js',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;600;700;800&display=swap'
];

// ── УСТАНОВКА: кешируем App Shell ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Кешируем App Shell…');
        // Кешируем основные файлы — обязательно
        return cache.addAll(STATIC_ASSETS)
          .then(() => {
            // Кешируем CDN-ресурсы по возможности (не критично)
            return Promise.allSettled(
              CDN_ASSETS.map(url =>
                fetch(url, { mode: 'cors' })
                  .then(res => {
                    if (res.ok) return cache.put(url, res);
                  })
                  .catch(() => {}) // CDN недоступен — не страшно
              )
            );
          });
      })
      .then(() => {
        console.log('[SW] App Shell закеширован');
        return self.skipWaiting(); // Активируемся немедленно
      })
      .catch(err => console.error('[SW] Ошибка кеширования:', err))
  );
});

// ── АКТИВАЦИЯ: удаляем старые кеши ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Удаляем старый кеш:', key);
            return caches.delete(key);
          })
      ))
      .then(() => {
        console.log('[SW] Активирован, захватываем клиентов');
        return self.clients.claim(); // Управляем страницами без перезагрузки
      })
  );
});

// ── ПЕРЕХВАТ ЗАПРОСОВ ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Пропускаем не-GET запросы (POST, WebSocket upgrade и т.д.)
  if (req.method !== 'GET') return;

  // Пропускаем WebSocket и API-запросы к серверу
  if (
    url.pathname.includes('/api/') ||
    url.pathname.includes('/socket.io') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return;
  }

  // Пропускаем chrome-extension и другие нестандартные схемы
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(handleFetch(req));
});

async function handleFetch(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  if (cached) {
    // ── Cache-First: отдаём из кеша немедленно ──────────────────
    // Параллельно обновляем кеш в фоне (Stale-While-Revalidate)
    updateCacheInBackground(cache, req);
    return cached;
  }

  // ── Network-First: ресурс не закеширован ────────────────────────
  try {
    const networkRes = await fetch(req);

    if (networkRes && networkRes.status === 200) {
      // Кешируем только «безопасные» ответы (не opaque cross-origin без CORS)
      const resType = networkRes.type; // 'basic' | 'cors' | 'opaque'
      if (resType === 'basic' || resType === 'cors') {
        cache.put(req, networkRes.clone());
      }
    }

    return networkRes;
  } catch (_networkError) {
    // ── Офлайн-фолбэк ───────────────────────────────────────────
    console.warn('[SW] Сеть недоступна, ищем фолбэк для:', req.url);

    // Для навигационных запросов (открытие страницы) — возвращаем index.html
    if (req.mode === 'navigate') {
      const fallback =
        (await cache.match('./index.html')) ||
        (await cache.match('./')) ||
        (await cache.match('/index.html')) ||
        (await cache.match('/'));

      if (fallback) {
        console.log('[SW] Возвращаем закешированный index.html (офлайн)');
        return fallback;
      }
    }

    // Для остальных ресурсов — возвращаем пустой ответ, чтобы не крашить SW
    return new Response('', {
      status: 503,
      statusText: 'Service Unavailable (offline)'
    });
  }
}

// Фоновое обновление кеша без блокировки ответа
function updateCacheInBackground(cache, req) {
  fetch(req)
    .then(res => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        cache.put(req, res);
      }
    })
    .catch(() => {}); // Молча игнорируем — мы уже отдали ответ из кеша
}
