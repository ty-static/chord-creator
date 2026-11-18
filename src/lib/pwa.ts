// Installing Chord Creator as an app and running it offline: registers the
// service worker (sw.js, written by the build), offers updates, and keeps
// the browser's install prompt for the "Install app" menu item.

import * as React from "react"

/** Chrome and Edge's install prompt (not in the DOM typings yet). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/** Whether the app is running installed, in its own window. */
export const isStandalone = (win: Window = window) =>
  win.matchMedia?.("(display-mode: standalone)").matches ||
  (win.navigator as Navigator & { standalone?: boolean }).standalone === true

/** iPhones and iPads, where apps are installed from Safari's Share menu. */
export const isIos = (nav: Navigator = navigator) =>
  /iPhone|iPad|iPod/.test(nav.userAgent) ||
  (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)

let registered = false

/**
 * Register the service worker (in production builds). Calls `onUpdate` when
 * a new version has downloaded and is waiting; calling the function it's
 * given switches to the new version and reloads the page.
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void) {
  if (registered || !import.meta.env.PROD || !("serviceWorker" in navigator))
    return
  registered = true
  const sw = navigator.serviceWorker
  const offer = (reg: ServiceWorkerRegistration) => {
    // The first install isn't an update: there's no older version running.
    if (!reg.waiting || !sw.controller) return
    onUpdate(() => {
      sw.addEventListener("controllerchange", () => location.reload(), {
        once: true,
      })
      reg.waiting?.postMessage({ type: "skip-waiting" })
    })
  }
  sw.register("/sw.js")
    .then((reg) => {
      offer(reg)
      reg.addEventListener("updatefound", () => {
        const next = reg.installing
        next?.addEventListener("statechange", () => {
          if (next.state === "installed") offer(reg)
        })
      })
      // Look for a new version whenever the app comes back into view.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update()
      })
    })
    .catch((err) => console.warn("Offline support unavailable", err))
}

/**
 * How the app can be installed here: "prompt" (the browser can show its
 * install dialog), "ios" (from the Share menu), or null (installed already,
 * or the browser can't).
 */
export function useInstall() {
  const [prompt, setPrompt] = React.useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = React.useState(() => isStandalone())
  React.useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // shown from the menu instead
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])
  const how: "prompt" | "ios" | null = installed
    ? null
    : prompt
      ? "prompt"
      : isIos()
        ? "ios"
        : null
  const install = async () => {
    if (!prompt) return false
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    setPrompt(null) // a prompt can only be shown once
    return outcome === "accepted"
  }
  return { how, install }
}

/** Whether the browser is online, kept up to date. */
export function useOnline() {
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb)
      window.addEventListener("offline", cb)
      return () => {
        window.removeEventListener("online", cb)
        window.removeEventListener("offline", cb)
      }
    },
    () => navigator.onLine,
    () => true
  )
}
