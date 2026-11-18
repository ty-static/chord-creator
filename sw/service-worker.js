// The service worker that lets Chord Creator open and run offline.
//
// The build (vite.config.ts) fills in __VERSION__ and __PRECACHE__, the list
// of every file the app is made of. They're downloaded when the worker
// installs, so the whole app works offline from the first visit.
//
// Instrument samples are cached by the audio library itself (in its own
// "chord-creator-samples" cache) as they're first used, so they aren't
// handled here.

const VERSION = __VERSION__
const PRECACHE = __PRECACHE__
const CACHE = `chord-creator-app-${VERSION}`
/** How long to wait for the network before opening the cached page. */
const NETWORK_TIMEOUT = 3000

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop older versions of the app (never the samples).
      for (const key of await caches.keys())
        if (key.startsWith("chord-creator-app-") && key !== CACHE)
          await caches.delete(key)
      await self.clients.claim()
    })()
  )
})

// The page asks a waiting update to take over when the user says so.
self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting()
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === "navigate") {
    // The page: fresh from the network when it answers quickly, otherwise
    // the cached copy. (Share links add ?song=…, which the page reads itself.)
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const cached = await cache.match("/", { ignoreVary: true })
        const network = fetch(req).then((res) => {
          if (res.ok && url.pathname === "/") void cache.put("/", res.clone())
          return res
        })
        if (!cached) return network
        const timeout = new Promise((resolve) =>
          setTimeout(() => resolve(cached), NETWORK_TIMEOUT)
        )
        try {
          return await Promise.race([network, timeout])
        } catch {
          return cached
        }
      })()
    )
    return
  }

  // Everything else: files names carry a hash of their content, so a cached
  // copy is always right. Anything not cached yet is fetched and kept.
  event.respondWith(
    (async () => {
      // Module scripts and fonts are requested with an Origin header, and
      // servers often answer "Vary: Origin", which would hide the copy
      // cached without one.
      const cached = await caches.match(req, { ignoreVary: true })
      if (cached) return cached
      const res = await fetch(req)
      if (res.ok && res.type === "basic") {
        const cache = await caches.open(CACHE)
        void cache.put(req, res.clone())
      }
      return res
    })()
  )
})
