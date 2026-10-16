/* ============================================================================
   sw.js — cache-first service worker.

   A Home Screen app that breaks without signal is worse than no app, so the
   whole shell (HTML, CSS, every ES module, the manifest and the icons) is
   precached on install and served from cache thereafter, with the network
   consulted in the background to keep entries fresh.

   Bump CACHE whenever shell files change; the old cache is dropped on activate.
   ========================================================================= */

const CACHE = 'runna-v5';

/* Everything needed to boot the app offline. `./` and `./index.html` are both
   listed because either can be the navigation URL. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',

  './css/tokens.css',
  './css/app.css',

  './js/app.js',

  './js/ui/components.js',
  './js/ui/motion.js',

  './js/domain/store.js',
  './js/domain/format.js',

  './js/engine/enums.js',
  './js/engine/raceMath.js',
  './js/engine/pace.js',
  './js/engine/planGenerator.js',
  './js/engine/sessionLibrary.js',

  './js/screens/onboarding.js',
  './js/screens/today.js',
  './js/screens/plan.js',
  './js/screens/progress.js',
  './js/screens/calendar.js',
  './js/screens/profile.js',

  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ---------------------------------------------------------------- install */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // allSettled, not addAll: a single 404 (a module another agent has not
    // written yet) must not abort the whole install and leave the app with no
    // cache at all.
    const results = await Promise.allSettled(
      SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
    );
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? SHELL[i] : null))
      .filter(Boolean);
    if (failed.length) {
      // Informative only — install still succeeds.
      console.info('[sw] not precached:', failed.join(', '));
    }
    await self.skipWaiting();
  })());
});

/* --------------------------------------------------------------- activate */

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => (key === CACHE ? null : caches.delete(key))));
    if (self.registration.navigationPreload) {
      try {
        await self.registration.navigationPreload.disable();
      } catch {
        /* not supported */
      }
    }
    await self.clients.claim();
  })());
});

/* ------------------------------------------------------------------ fetch */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Never touch anything that is not a GET. POST/PUT/DELETE go straight to the
  // network, uncached and unmodified.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Same-origin only: never proxy or cache third-party requests.
  if (url.origin !== self.location.origin) return;

  // Range requests (audio/video scrubbing) cannot be served from a plain cache.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

/* Navigation: cached shell first, network as a fallback, index.html last. */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  const cached = (await cache.match(request, { ignoreSearch: true }))
    || (await cache.match('./index.html'))
    || (await cache.match('./'));

  if (cached) {
    revalidate(request, cache);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put('./index.html', response.clone());
    return response;
  } catch (err) {
    return new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<body style="margin:0;background:#181B21;color:#fff;font:16px -apple-system,system-ui;'
      + 'display:grid;place-items:center;height:100dvh;text-align:center">'
      + '<div><h1 style="font-size:20px">Offline</h1>'
      + '<p style="color:#AEB4BF">Runna has not been cached yet. Reconnect once and reopen the app.</p></div>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/* Cache-first, then network; the network copy refreshes the cache in the
   background so the next launch gets the newer file. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });

  if (cached) {
    revalidate(request, cache);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Last resort: an offline miss for a same-origin asset.
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* Fire-and-forget background update (stale-while-revalidate). */
function revalidate(request, cache) {
  fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
    })
    .catch(() => {
      /* offline: the cached copy stands */
    });
}

/* --------------------------------------------------------------- messages */

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.delete(CACHE));
  }
});
