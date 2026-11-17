// The song library in the browser's local storage. Each song is stored on
// its own, plus a small index for listing, so a tab only rewrites the song
// it has open.

import { layout, type Song } from "@/lib/arrange"
import { keyLabel, uid } from "@/lib/music"
import { normalizeSong } from "@/lib/song-file"

/** Where a single song was kept before the library existed. */
export const LEGACY_KEY = "chord-creator:song"
const INDEX_KEY = "chord-creator:library"
const CURRENT_KEY = "chord-creator:current"
const songKey = (id: string) => `chord-creator:songs:${id}`

export interface LibraryEntry {
  id: string
  title: string
  /** Last change, in ms since 1970. */
  updated: number
  /** Shown in the list: key, length and sections. */
  summary: string
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">

export function summarize(song: Song) {
  const beats = layout(song).reduce((n, p) => n + p.beats, 0)
  const bars = Math.round(beats / 4)
  const sections = song.sections.length
  return [
    keyLabel(song.key),
    `${song.bpm} BPM`,
    `${bars} ${bars === 1 ? "bar" : "bars"}`,
    ...(sections > 1 ? [`${sections} sections`] : []),
  ].join(" · ")
}

export class Library {
  private store: Store
  /** Set when storage is full or blocked, so the app can say so once. */
  lastError: unknown = null

  constructor(store: Store) {
    this.store = store
  }

  /** Every song, most recently changed first. */
  list(): LibraryEntry[] {
    try {
      const raw = JSON.parse(this.store.getItem(INDEX_KEY) ?? "[]")
      return (Array.isArray(raw) ? (raw as LibraryEntry[]) : [])
        .filter((e) => e && typeof e.id === "string")
        .sort((a, b) => b.updated - a.updated)
    } catch {
      return []
    }
  }

  /** A song from the library, or null if it's missing or unreadable. */
  load(id: string): Song | null {
    try {
      const raw = this.store.getItem(songKey(id))
      return raw ? normalizeSong(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }

  /** Save a song (new or changed). Returns false if storage refused it. */
  save(id: string, song: Song, now = Date.now()): boolean {
    try {
      this.store.setItem(songKey(id), JSON.stringify(song))
      const entry: LibraryEntry = {
        id,
        title: song.title,
        updated: now,
        summary: summarize(song),
      }
      const index = this.list().filter((e) => e.id !== id)
      this.store.setItem(INDEX_KEY, JSON.stringify([entry, ...index]))
      this.lastError = null
      return true
    } catch (err) {
      this.lastError = err
      return false
    }
  }

  /** Add a song as a new entry. Returns its id. */
  add(song: Song, now = Date.now()): string {
    const id = uid()
    this.save(id, song, now)
    return id
  }

  remove(id: string) {
    try {
      this.store.removeItem(songKey(id))
      const index = this.list().filter((e) => e.id !== id)
      this.store.setItem(INDEX_KEY, JSON.stringify(index))
    } catch {
      /* nothing to do */
    }
  }

  /** The song that was open last time. */
  currentId(): string | null {
    try {
      return this.store.getItem(CURRENT_KEY)
    } catch {
      return null
    }
  }

  setCurrent(id: string) {
    try {
      this.store.setItem(CURRENT_KEY, id)
    } catch {
      /* not remembered: the most recent song opens instead */
    }
  }

  /**
   * The song to open on start: the one open last time, else the most recent,
   * else `fallback`. A song saved before the library existed moves in first.
   */
  open(fallback: () => Song): { id: string; song: Song } {
    this.migrateLegacy()
    const ids = [this.currentId(), ...this.list().map((e) => e.id)]
    for (const id of ids) {
      if (!id) continue
      const song = this.load(id)
      if (song) {
        this.setCurrent(id)
        return { id, song }
      }
    }
    const song = fallback()
    const id = this.add(song)
    this.setCurrent(id)
    return { id, song }
  }

  private migrateLegacy() {
    let raw: string | null
    try {
      raw = this.store.getItem(LEGACY_KEY)
    } catch {
      return
    }
    if (!raw) return
    try {
      const song = normalizeSong(JSON.parse(raw))
      if (song.title === "Untitled song") song.title = "My song"
      const id = this.add(song)
      if (this.load(id)) {
        this.setCurrent(id)
        this.store.removeItem(LEGACY_KEY)
      }
    } catch {
      // Unreadable: leave it where it is rather than lose it.
    }
  }
}
