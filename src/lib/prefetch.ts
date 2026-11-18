// Code that isn't needed to show the page (dialogs, the MIDI parser, the WAV
// renderer, the sampler library) is split into separate files. Once the page
// is up and the browser is idle, fetch them in the background so the first
// click on Import, My songs, Export or Play doesn't wait for a download.
//
// The import() calls are the same ones the app makes later, so the browser
// and the bundler's module cache share them: nothing is downloaded twice.

export const LAZY_MODULES: (() => Promise<unknown>)[] = [
  () => import("smplr"),
  () => import("@/components/song-library"),
  () => import("@/components/import-dialog"),
  () => import("@/lib/midi-import"),
  () => import("@/lib/render"),
  () => import("@/components/welcome-tour"),
]

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

interface Connection {
  saveData?: boolean
}

/**
 * Whether the visitor asked the browser to save data. (The connection's
 * estimated speed isn't used: browsers report "2g" even for localhost.)
 */
export function shouldSkip(connection: Connection | undefined) {
  return !!connection?.saveData
}

/**
 * Fetch the lazily loaded modules one after another when the browser is
 * idle. Returns a function that cancels whatever hasn't started yet.
 */
export function prefetchLazyModules(
  modules = LAZY_MODULES,
  win: IdleWindow = window
): () => void {
  const connection = (navigator as Navigator & { connection?: Connection })
    .connection
  if (shouldSkip(connection)) return () => {}
  let cancelled = false
  let handle: number | undefined
  const idle = (cb: () => void) =>
    win.requestIdleCallback
      ? win.requestIdleCallback(cb, { timeout: 4000 })
      : win.setTimeout(cb, 1500)
  const next = (i: number) => {
    if (cancelled || i >= modules.length) return
    handle = idle(() => {
      handle = undefined
      // A failed download is fine: the app tries again when it's needed.
      modules[i]()
        .catch(() => {})
        .finally(() => next(i + 1))
    })
  }
  next(0)
  return () => {
    cancelled = true
    if (handle === undefined) return
    if (win.cancelIdleCallback) win.cancelIdleCallback(handle)
    else win.clearTimeout(handle)
  }
}
