// Snow Game Radar service worker: offline shell + push notifications.
importScripts('config.js');

const CACHE = 'snow-radar-v10';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/mark-96.png', 'icons/mark-mini-96.png', 'icons/crest-512.png'];
const API = ((self.SNOW_RADAR && self.SNOW_RADAR.workerUrl) || '').replace(/\/$/, '');

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: serve from cache, refresh in the background. API calls: always network.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then(res => {
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// Pushes arrive without a payload; fetch what the alert is about.
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let items = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const mine = sub ? '?e=' + encodeURIComponent(sub.endpoint) : '';
      const res = await fetch(API + '/alerts/latest' + mine, { cache: 'no-store' });
      items = (await res.json()).items || [];
    } catch (e) { /* fall through to a generic alert */ }
    if (!items.length) items = [{ title: 'Snow game alert', body: 'Open Snow Game Radar to see the forecast.', tag: 'generic' }];

    await Promise.all(items.map(item => self.registration.showNotification(item.title, {
      body: item.body,
      tag: item.tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      vibrate: [120, 60, 120],
      data: { url: item.game ? './#game-' + item.game : './' }
    })));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = event.notification.data?.url || './';
    for (const c of all) { if ('focus' in c) { c.navigate?.(target); return c.focus(); } }
    return clients.openWindow(target);
  })());
});
