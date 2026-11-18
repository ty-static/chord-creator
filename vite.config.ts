import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { type Plugin, defineConfig } from "vite"

/** Every file in public/ (icons, the manifest), as site paths. */
function publicFiles(dir = resolve(import.meta.dirname, "public")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? publicFiles(join(dir, e.name))
      : [
          "/" +
            relative(resolve(import.meta.dirname, "public"), join(dir, e.name))
              .split(sep)
              .join("/"),
        ]
  )
}

/**
 * Writes sw.js, the service worker that makes the app work offline, with the
 * list of every file of this build. Its version changes whenever any file
 * does, which is how browsers notice an update.
 */
function serviceWorker(): Plugin {
  return {
    name: "chord-creator-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const files = [
        "/",
        ...Object.keys(bundle)
          .filter((f) => f !== "index.html" && !f.endsWith(".map"))
          .map((f) => "/" + f),
        ...publicFiles(),
      ].sort()
      const hash = createHash("sha256")
      for (const [name, out] of Object.entries(bundle).sort())
        hash.update(name).update(out.type === "chunk" ? out.code : out.source)
      const template = readFileSync(
        resolve(import.meta.dirname, "sw/service-worker.js"),
        "utf8"
      )
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace(
            "const VERSION = __VERSION__",
            "const VERSION = " + JSON.stringify(hash.digest("hex").slice(0, 12))
          )
          .replace(
            "const PRECACHE = __PRECACHE__",
            "const PRECACHE = " + JSON.stringify(files, null, 2)
          ),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // React rarely changes, so it gets its own chunk that browsers keep
        // cached across app updates. (Audio, MIDI import and the dialogs are
        // split off with dynamic imports and load when first used.)
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
})
