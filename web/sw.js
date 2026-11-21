// Only makes the page installable as an app (share target on mobile).
// No cache: everything always comes fresh from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
