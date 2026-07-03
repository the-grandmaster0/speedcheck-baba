const CACHE_NAME = 'speedcheck-baba-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Only intercept GET requests (upload tests use POST)
  if (event.request.method !== 'GET') {
    return;
  }

  // Bypass service worker for cross-origin API calls (like speed test targets)
  try {
    const url = new URL(event.request.url);
    if (url.hostname !== self.location.hostname) {
      return;
    }
  } catch (e) {
    // Ignore invalid URLs
  }

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }
      // Return a valid error response instead of undefined to prevent service worker crashes
      return new Response('Network error occurred', { status: 408, statusText: 'Network Error' });
    })
  );
});
