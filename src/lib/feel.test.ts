import { describe, expect, it } from "vitest"

import { type Song, buildEvents, layout } from "@/lib/arrange"
import { EXAMPLES } from "@/lib/examples"
import { HUMANIZE_TIME, noise, swingTime } from "@/lib/feel"
import { decodeShare, encodeShare, normalizeSong } from "@/lib/song-file"

const ALL = { chords: true, melody: true, bass: true, drums: true }
const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()

/** Events of the slot at `index` in the form, relative to its start. */
function slotEvents(song: Song, index: number) {
  const p = layout(song)[index]
  return buildEvents(song, ALL)
    .filter((e) => e.start >= p.start && e.start < p.start + p.beats)
    .map((e) => ({ ...e, start: e.start - p.start }))
}

/** A copy of the pop song with the first section (A) changed. */
function withA(patch: Partial<Song["sections"][number]>, song = pop()) {
  return {
    ...song,
    sections: song.sections.map((s, i) => (i === 0 ? { ...s, ...patch } : s)),
  }
}

describe("section style", () => {
  it("leaves tracks out of one section only", () => {
    const song = withA({ tacet: ["melody", "bass"] })
    const a = slotEvents(song, 0)
    expect(a.some((e) => e.track === "melody")).toBe(false)
    expect(a.some((e) => e.track === "bass")).toBe(false)
    expect(a.some((e) => e.track === "chords")).toBe(true)
    // The chorus (B, slot 2) still has its melody.
    const bSlot = layout(song).findIndex((p) => p.section !== song.sections[0])
    expect(slotEvents(song, bSlot).some((e) => e.track === "melody")).toBe(true)
  })

  it("gives a section its own chord rhythm", () => {
    const song = {
      ...withA({ chordStyle: "pulse" }),
      chordStyle: "block" as const,
    }
    const chords = slotEvents(song, 0).filter((e) => e.track === "chords")
    const starts = new Set(chords.map((e) => e.start))
    // Pulse hits every beat; block only where chords change.
    expect(starts.size).toBe(layout(song)[0].beats)
  })

  it("scales loudness by energy, within MIDI limits", () => {
    const plain = slotEvents(pop(), 0)
    const soft = slotEvents(withA({ energy: 0.5 }), 0)
    const loud = slotEvents(withA({ energy: 1.5 }), 0)
    soft.forEach((e, i) =>
      expect(e.velocity).toBe(Math.max(1, Math.round(plain[i].velocity * 0.5)))
    )
    expect(Math.max(...loud.map((e) => e.velocity))).toBeLessThanOrEqual(127)
    expect(loud[0].velocity).toBeGreaterThan(plain[0].velocity)
  })

  it("changes key for pitched tracks but not drums", () => {
    const plain = slotEvents(pop(), 0)
    const up = slotEvents(withA({ transpose: 2 }), 0)
    up.forEach((e, i) =>
      expect(e.midi).toBe(plain[i].midi + (e.track === "drums" ? 0 : 2))
    )
  })

  it("is kept in files and share links, and cleaned up", async () => {
    const song = withA({
      tacet: ["melody"],
      chordStyle: "arpeggio",
      energy: 0.8,
      transpose: -3,
    })
    const back = await decodeShare(await encodeShare(song))
    expect(back.sections[0]).toMatchObject({
      tacet: ["melody"],
      chordStyle: "arpeggio",
      energy: 0.8,
      transpose: -3,
    })
    const odd = normalizeSong(
      withA({
        tacet: ["melody", "kazoo"] as never,
        chordStyle: "polka" as never,
        energy: 9,
        transpose: 40,
      })
    ).sections[0]
    expect(odd.tacet).toEqual(["melody"])
    expect(odd.chordStyle).toBeUndefined()
    expect(odd.energy).toBe(1.5)
    expect(odd.transpose).toBe(6)
    // Defaults aren't written out.
    const plain = normalizeSong(withA({ energy: 1, transpose: 0, tacet: [] }))
    expect(Object.keys(plain.sections[0]).sort()).toEqual(
      ["chords", "drums", "id", "melody", "name"].sort()
    )
  })
})

describe("swing", () => {
  it("leaves beats alone and moves the off-beat later", () => {
    for (const b of [0, 1, 7]) expect(swingTime(b, 1)).toBe(b)
    expect(swingTime(2.5, 0)).toBe(2.5)
    expect(swingTime(2.5, 1)).toBeCloseTo(2 + 2 / 3) // triplet feel
    expect(swingTime(2.5, 0.5)).toBeCloseTo(2.5 + 1 / 12)
  })

  it("keeps notes in order", () => {
    let last = -1
    for (let x = 0; x < 4; x += 0.125) {
      const t = swingTime(x, 0.8)
      expect(t).toBeGreaterThan(last)
      last = t
    }
  })

  it("swings the song's off-beats and nothing else when straight", () => {
    const straight = buildEvents(pop(), ALL)
    expect(buildEvents({ ...pop(), swing: 0 }, ALL)).toEqual(straight)
    const swung = buildEvents({ ...pop(), swing: 1 }, ALL)
    expect(swung).toHaveLength(straight.length)
    straight.forEach((e, i) => {
      const frac = e.start % 1
      if (frac === 0) expect(swung[i].start).toBeCloseTo(e.start)
      if (frac === 0.5) expect(swung[i].start).toBeCloseTo(e.start + 1 / 6)
    })
  })
})

describe("humanize", () => {
  it("noise is repeatable and spread between -1 and 1", () => {
    expect(noise(1, 2, 3)).toBe(noise(1, 2, 3))
    const values = Array.from({ length: 500 }, (_, i) => noise(i, 7, i * 3))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1)
    expect(Math.max(...values)).toBeLessThanOrEqual(1)
    expect(Math.min(...values)).toBeLessThan(-0.8)
    expect(Math.max(...values)).toBeGreaterThan(0.8)
  })

  it("moves notes a little, the same way every time", () => {
    const song = { ...pop(), humanize: 1 }
    const plain = buildEvents(pop(), ALL)
    const a = buildEvents(song, ALL)
    expect(buildEvents(song, ALL)).toEqual(a)
    let moved = 0
    a.forEach((e, i) => {
      const d = e.start - plain[i].start
      expect(Math.abs(d)).toBeLessThanOrEqual(HUMANIZE_TIME + 1e-9)
      if (Math.abs(d) > 1e-6) moved++
      expect(e.velocity).toBeGreaterThanOrEqual(1)
      expect(e.velocity).toBeLessThanOrEqual(127)
    })
    expect(moved).toBeGreaterThan(a.length / 2)
  })

  it("never moves a note before the start of its slot", () => {
    const song = { ...pop(), humanize: 1, swing: 0.6 }
    const placed = layout(song)
    const events = buildEvents(song, ALL)
    for (const p of placed) {
      const first = events.filter(
        (e) => e.start >= p.start - HUMANIZE_TIME && e.start < p.start + 0.01
      )
      for (const e of first) expect(e.start).toBeGreaterThanOrEqual(p.start)
    }
  })

  it("is saved with the song", async () => {
    const back = await decodeShare(
      await encodeShare({ ...pop(), swing: 0.4, humanize: 0.25 })
    )
    expect(back.swing).toBe(0.4)
    expect(back.humanize).toBe(0.25)
    expect("swing" in normalizeSong(pop())).toBe(false)
  })
})

describe("every example, played every way", () => {
  it("builds valid notes inside the song", () => {
    const styles = [
      {},
      { tacet: ["chords", "melody", "bass"] as const },
      { chordStyle: "arpeggio" as const, energy: 1.5, transpose: 6 },
      { chordStyle: "pulse" as const, energy: 0.5, transpose: -6 },
    ]
    for (const ex of EXAMPLES)
      for (const style of styles)
        for (const feel of [{}, { swing: 1, humanize: 1 }]) {
          const base = ex.build()
          const song: Song = {
            ...base,
            ...feel,
            sections: base.sections.map((s) => ({
              ...s,
              ...style,
              tacet: style.tacet && [...style.tacet],
            })),
          }
          const end = layout(song).reduce((n, p) => n + p.beats, 0)
          for (const e of buildEvents(song, ALL)) {
            expect(e.start).toBeGreaterThanOrEqual(0)
            expect(e.start).toBeLessThan(end)
            expect(e.duration).toBeGreaterThan(0)
            expect(Number.isInteger(e.midi)).toBe(true)
            expect(e.midi).toBeGreaterThanOrEqual(0)
            expect(e.midi).toBeLessThanOrEqual(127)
            expect(e.velocity).toBeGreaterThanOrEqual(1)
            expect(e.velocity).toBeLessThanOrEqual(127)
          }
        }
  })
})
