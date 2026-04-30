/* ================================================================
   NABDH نبض — Service Worker v4.0 ULTRA
   Strategies:
   - Static assets  → Cache First (7 days)
   - API calls      → Network First (30s cache fallback)
   - HTML pages     → Network First (fallback to offline page)
   - Background sync for failed POST requests
================================================================ */

const CACHE_NAME    = 'nabdh-v4';
const CACHE_STATIC  = 'nabdh-static-v4';
const OFFLINE_URL   = '/offline.html';

// Files to pre-cache on install
const PRECACHE = [
  '/',
  '/offline.html',
  '/css/style.css',
  '/js/app.js',
  '/favicon.svg',
  '/manifest.json'
];

// API routes that are safe to cache
const CACHEABLE_API = [
  '/api/stats',
  '/api/alerts',
  '/api/exchange',
  '/api/medicines',
  '/api/market',
  '/api/geo/sudan',
  '/api/hospitals',
  '/api/prayer',
  '/api/leaderboard'
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== CACHE_STATIC)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin (socket.io, CDN, etc.)
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io')) return;

  // API calls → Network First, fallback cache
  if (url.pathname.startsWith('/api/')) {
    const isCacheable = CACHEABLE_API.some(p => url.pathname.startsWith(p));
    event.respondWith(networkFirstAPI(request, isCacheable));
    return;
  }

  // Static assets → Cache First (long TTL)
  if (url.pathname.match(/\.(css|js|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$/)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML / navigation → Network First, fallback offline
  event.respondWith(networkFirstHTML(request));
});

// ── Cache First ───────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

// ── Network First HTML ────────────────────────────────────────
async function networkFirstHTML(request) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const response = await fetch(request, { signal: ctrl.signal });
    clearTimeout(tid);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response(
      '<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"/><title>غير متصل</title></head><body style="font-family:sans-serif;text-align:center;padding:2rem;background:#0a0e1a;color:#e8edf5"><h1>💓 نبض</h1><h2>📵 أنت غير متصل بالإنترنت</h2><p>تحقق من اتصالك وأعد المحاولة</p><button onclick="location.reload()" style="background:#1abc9c;color:#fff;border:none;padding:.8rem 1.5rem;border-radius:2rem;cursor:pointer;font-size:1rem">🔄 إعادة المحاولة</button></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
    );
  }
}

// ── Network First API ─────────────────────────────────────────
async function networkFirstAPI(request, cacheable) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const response = await fetch(request, { signal: ctrl.signal });
    clearTimeout(tid);
    if (response.ok && cacheable) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (cacheable) {
      const cached = await caches.match(request);
      if (cached) return cached;
    }
    return new Response(
      JSON.stringify({ error: 'offline', cached: false, ts: Date.now() }),
      { headers: { 'Content-Type': 'application/json' }, status: 503 }
    );
  }
}

// ── Push Notifications ───────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '💓 نبض';
  const options = {
    body:    data.body   || 'تنبيه جديد في منطقتك',
    icon:    '/favicon.svg',
    badge:   '/images/icon-192.png',
    tag:     data.tag    || 'nabdh-alert',
    data:    { url: data.url || '/' },
    dir:     'rtl',
    lang:    'ar',
    vibrate: [200, 100, 200],
    requireInteraction: data.urgent || false,
    actions: [
      { action: 'view',    title: '👁️ عرض' },
      { action: 'dismiss', title: '✕ إغلاق' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Background Sync (for failed reports) ─────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(syncPendingReports());
  }
});

async function syncPendingReports() {
  try {
    const cache = await caches.open('nabdh-pending');
    const requests = await cache.keys();
    for (const req of requests) {
      try {
        const resp = await fetch(req.clone());
        if (resp.ok) await cache.delete(req);
      } catch {}
    }
  } catch {}
}

// ── Periodic Background Sync ──────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'refresh-stats') {
    event.waitUntil(
      fetch('/api/stats').then(r => {
        if (r.ok) return caches.open(CACHE_NAME).then(c => c.put('/api/stats', r));
      }).catch(() => {})
    );
  }
});

// ── Message handler (skip waiting) ───────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearCache') {
    caches.delete(CACHE_NAME).then(() => self.clients.matchAll().then(clients => {
      clients.forEach(c => c.postMessage({ type: 'cacheCleared' }));
    }));
  }
});
