/* notlichess.org: the service worker's off switch. In an emergency, deploy
   this file as /sw.js in place of the normal worker (README.md, Deploy):
   it takes over from the worker in charge at once, deletes every cache
   named notlichess-* (no other) and unregisters itself. It has no fetch
   handler, so every request goes to the network, as if there had never
   been a worker. To return to the normal worker, deploy sw.js from git. */
'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n.indexOf('notlichess-') === 0; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.registration.unregister(); }));
});
