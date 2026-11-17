import { describe, expect, it } from "vitest"

import { type Song, buildEvents, layout } from "@/lib/arrange"
import { EXAMPLES } from "@/lib/examples"
import { LEGACY_KEY, Library } from "@/lib/library"
import { formString } from "@/lib/sections"
import {
  DEFAULT_TITLE,
  SongFileError,
  decodeShare,
  defaultSong,
  encodeShare,
  fileSlug,
  normalizeSong,
  parseSongFile,
  sameSong,
  shareCode,
  shareUrl,
  songFile,
} from "@/lib/song-file"

const ALL = { chords: true, melody: true, bass: true, drums: true }
const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()

/** What a song sounds like, ignoring ids. */
const music = (s: Song) =>
  buildEvents(s, ALL)
    .map((e) => [e.track, e.midi, e.start, e.duration, e.velocity].join())
    .sort()

/** Everything about a song except ids. */
const shape = (s: Song) =>
  JSON.stringify(s, (k, v) => (k === "id" || k === "section" ? undefined : v))

class MemoryStore {
  data = new Map<string, string>()
  full = false
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    if (this.full) throw new DOMException("full", "QuotaExceededError")
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

describe("normalizeSong", () => {
  it("keeps a valid song as it is", () => {
    for (const ex of EXAMPLES) {
      const s = ex.build()
      expect(normalizeSong(JSON.parse(JSON.stringify(s)))).toEqual(
        expect.objectContaining({ title: s.title, key: s.key, bpm: s.bpm })
      )
      expect(shape(normalizeSong(structuredClone(s)))).toBe(shape(s))
    }
  })

  it("reads a song saved before sections existed", () => {
    const old = {
      key: { root: 2, scale: "dorian" },
      bpm: 90,
      chords: [{ id: "a", degree: 0, type: "triad", inversion: 0, beats: 4 }],
      melody: [{ id: "m", start: 0, length: 2, degree: 4 }],
      drums: { enabled: true },
    }
    const s = normalizeSong(old)
    expect(s.title).toBe(DEFAULT_TITLE)
    expect(s.sections).toHaveLength(1)
    expect(s.sections[0].chords[0].degree).toBe(0)
    expect(s.sections[0].melody).toHaveLength(1)
    expect(s.sections[0].drums.enabled).toBe(true)
    expect(formString(s)).toBe("A")
  })

  it("repairs out-of-range and unknown values", () => {
    const s = normalizeSong({
      title: "   ",
      key: { root: 40, scale: "klingon" },
      bpm: 9000,
      chordStyle: "polka",
      reverb: -3,
      instruments: { chords: "kazoo", melody: "flute" },
      mix: { melody: { volume: 7, mute: "yes" } },
      sections: [
        {
          name: "x".repeat(100),
          chords: [
            { degree: 12.6, type: "power", inversion: 9, beats: -1 },
            "nonsense",
            { type: "triad" }, // no degree
          ],
          melody: [
            { start: 0, length: 4, degree: 99 },
            { start: 2, length: 1, degree: 3 }, // overlaps the first
            { start: 7, length: 10, degree: 3 }, // runs past the end
            { start: 50, length: 1, degree: 3 }, // past the end
          ],
          drums: {
            enabled: true,
            pattern: { kick: [2, 9, "a"], cowbell: [1] },
          },
        },
      ],
      arrangement: [{ section: "missing" }],
    })
    expect(s.title).toBe(DEFAULT_TITLE)
    expect(s.key).toEqual({ root: 11, scale: "major" })
    expect(s.bpm).toBe(200)
    expect(s.chordStyle).toBe("block")
    expect(s.reverb).toBe(0)
    expect(s.instruments.chords).toBe("grand_piano")
    expect(s.instruments.melody).toBe("flute")
    expect(s.mix.melody).toEqual({ volume: 1, mute: false, solo: false })
    const sec = s.sections[0]
    expect(sec.name).toHaveLength(24)
    expect(sec.chords).toEqual([
      {
        id: expect.any(String),
        degree: 6,
        type: "triad",
        inversion: 3,
        beats: 1,
      },
    ])
    // One beat of chords = 2 melody steps.
    expect(sec.melody.map((n) => [n.start, n.length, n.degree])).toEqual([
      [0, 2, 14],
    ])
    expect(sec.drums.pattern.kick.slice(0, 3)).toEqual([2, 2, 0])
    expect(sec.drums.pattern.kick).toHaveLength(16)
    expect("cowbell" in sec.drums.pattern).toBe(false)
    expect(s.arrangement.map((x) => x.section)).toEqual([sec.id])
  })

  it("rejects things that aren't songs", () => {
    for (const bad of [null, 42, "song", [], {}, { sections: [] }])
      expect(() => normalizeSong(bad)).toThrow(SongFileError)
    expect(() =>
      normalizeSong({ sections: [{ name: "A", chords: [] }] })
    ).toThrow("no chords")
  })

  it("gives sections unique ids", () => {
    const s = pop()
    const raw = structuredClone(s)
    raw.sections[1].id = raw.sections[0].id
    const out = normalizeSong(raw)
    expect(new Set(out.sections.map((x) => x.id)).size).toBe(3)
  })
})

describe("song files", () => {
  const read = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

  it("round-trips one song", () => {
    const s = pop()
    const [back] = parseSongFile(read(songFile([s])))
    expect(shape(back)).toBe(shape(s))
    expect(music(back)).toEqual(music(s))
  })

  it("round-trips a backup of many songs", () => {
    const songs = EXAMPLES.map((e) => e.build())
    const back = parseSongFile(read(songFile(songs)))
    expect(back.map((s) => s.title)).toEqual(songs.map((s) => s.title))
  })

  it("skips broken songs in a backup but keeps the rest", () => {
    const text = JSON.stringify({
      app: "chord-creator",
      version: 1,
      songs: [{ nope: true }, pop()],
    })
    expect(parseSongFile(text).map((s) => s.title)).toEqual(["Pop Anthem"])
  })

  it("explains what's wrong with a bad file", () => {
    expect(() => parseSongFile("{not json")).toThrow("isn't valid JSON")
    expect(() =>
      parseSongFile(JSON.stringify({ app: "chord-creator", version: 99 }))
    ).toThrow("newer version")
    expect(() => parseSongFile(JSON.stringify({ hello: 1 }))).toThrow(
      SongFileError
    )
  })

  it("recognises the same song read back from a file", () => {
    const s = pop()
    const [back] = parseSongFile(read(songFile([s])))
    expect(sameSong(s, back)).toBe(true)
    expect(sameSong(s, { ...back, bpm: back.bpm + 1 })).toBe(false)
    expect(sameSong(s, { ...back, title: "Other" })).toBe(false)
  })

  it("makes safe file names from titles", () => {
    expect(fileSlug("Late Night Drive")).toBe("late-night-drive")
    expect(fileSlug("Café / Señor?")).toBe("cafe-senor")
    expect(fileSlug("!!!")).toBe("song")
  })
})

describe("share links", () => {
  it("round-trip every example, music and all", async () => {
    for (const ex of EXAMPLES) {
      const s = ex.build()
      const back = await decodeShare(await encodeShare(s))
      expect(shape(back)).toBe(shape(s))
      expect(music(back)).toEqual(music(s))
      expect(formString(back)).toBe(formString(s))
    }
  })

  it("stay short enough to paste anywhere", async () => {
    const code = await encodeShare(pop()) // 3 sections, 24 bars
    expect(code).toMatch(/^[\w-]+$/)
    expect(code.length).toBeLessThan(2000)
  })

  it("build a URL the app can read back", async () => {
    const url = await shareUrl(pop(), "https://example.com/app?x=1#old")
    expect(url.startsWith("https://example.com/app#song=")).toBe(true)
    const code = shareCode(new URL(url).hash)!
    expect((await decodeShare(code)).title).toBe("Pop Anthem")
    expect(shareCode("#other=1")).toBeNull()
  })

  it("report a cut-off link clearly", async () => {
    const code = await encodeShare(pop())
    await expect(decodeShare(code.slice(0, 40))).rejects.toThrow("broken")
    await expect(decodeShare("!!!")).rejects.toThrow(SongFileError)
  })
})

describe("Library", () => {
  it("saves, lists (newest first), loads and removes songs", () => {
    const lib = new Library(new MemoryStore())
    const a = lib.add({ ...pop(), title: "A" }, 1000)
    const b = lib.add({ ...defaultSong(), title: "B" }, 2000)
    expect(lib.list().map((e) => e.title)).toEqual(["B", "A"])
    expect(lib.list()[1].summary).toBe(
      "C Major · 112 BPM · 24 bars · 3 sections"
    )
    lib.save(a, { ...pop(), title: "A2" }, 3000)
    expect(lib.list().map((e) => e.title)).toEqual(["A2", "B"])
    expect(lib.load(a)?.title).toBe("A2")
    lib.remove(a)
    expect(lib.list().map((e) => e.id)).toEqual([b])
    expect(lib.load(a)).toBeNull()
  })

  it("reopens the song that was open last", () => {
    const store = new MemoryStore()
    const lib = new Library(store)
    const a = lib.add({ ...pop(), title: "A" }, 1)
    lib.add({ ...pop(), title: "B" }, 2)
    lib.setCurrent(a)
    expect(new Library(store).open(defaultSong).song.title).toBe("A")
  })

  it("starts with a default song when empty", () => {
    const lib = new Library(new MemoryStore())
    const { id, song } = lib.open(defaultSong)
    expect(song.title).toBe("My first song")
    expect(lib.list().map((e) => e.id)).toEqual([id])
  })

  it("moves the old single saved song into the library", () => {
    const store = new MemoryStore()
    const old = { ...pop(), title: undefined }
    store.setItem(LEGACY_KEY, JSON.stringify(old))
    const lib = new Library(store)
    const { song } = lib.open(defaultSong)
    expect(song.title).toBe("My song")
    expect(layout(song)).toHaveLength(6)
    expect(store.getItem(LEGACY_KEY)).toBeNull()
    expect(lib.list()).toHaveLength(1)
    // Only once.
    expect(new Library(store).list()).toHaveLength(1)
  })

  it("keeps an unreadable old save rather than lose it", () => {
    const store = new MemoryStore()
    store.setItem(LEGACY_KEY, "{broken")
    new Library(store).open(defaultSong)
    expect(store.getItem(LEGACY_KEY)).toBe("{broken")
  })

  it("skips a song that can't be read and opens the next one", () => {
    const store = new MemoryStore()
    const lib = new Library(store)
    lib.add({ ...pop(), title: "Good" }, 1)
    const bad = lib.add({ ...pop(), title: "Bad" }, 2)
    store.setItem(`chord-creator:songs:${bad}`, "garbage")
    expect(lib.open(defaultSong).song.title).toBe("Good")
  })

  it("reports when storage is full", () => {
    const store = new MemoryStore()
    const lib = new Library(store)
    const id = lib.add(pop())
    store.full = true
    expect(lib.save(id, pop())).toBe(false)
    expect(lib.lastError).toBeInstanceOf(DOMException)
    store.full = false
    expect(lib.save(id, pop())).toBe(true)
    expect(lib.lastError).toBeNull()
  })
})
