self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
// A no-op pass-through fetch handler kept only so browsers that require one
// for PWA installability see it registered — calling event.respondWith()
// here would force every request (including images and RSC payloads) through
// an extra promise hop into this worker's own fetch() before the browser's
// normal network stack ever sees it, purely to return the same bytes the
// browser would have fetched anyway. Leaving respondWith() uncalled lets the
// browser handle every request on its normal fast path.
self.addEventListener("fetch", () => {});
