import { describe, expect, it } from "vitest"

import {
  BUILD_UP_BEATS,
  type Section,
  type Song,
  buildEvents,
  layout,
} from "@/lib/arrange"
import {
  DEFAULT_DRUMS,
  DRUM_PIECES,
  type DrumSettings,
  type FillStyle,
  drumHits,
  presetPattern,
} from "@/lib/drums"
import { EXAMPLES } from "@/lib/examples"
import { addSlot } from "@/lib/sections"
import { decodeShare, encodeShare, normalizeSong } from "@/lib/song-file"

const midi = Object.fromEntries(DRUM_PIECES.map((p) => [p.id, p.midi]))
const ALL = { chords: true, melody: true, bass: true, drums: true }
const rock = (fill: FillStyle | null): DrumSettings => ({
  ...DEFAULT_DRUMS,
  enabled: true,
  pattern: presetPattern("rock"),
  fill: fill !== null,
  ...(fill && fill !== "snare" ? { fillStyle: fill } : {}),
})
const from = <T extends { start: number }>(hits: T[], beat: number) =>
  hits.filter((h) => h.start >= beat)

describe("fills", () => {
  const plain = drumHits(rock(null), 8)

  it("leave the beat alone before the fill", () => {
    for (const style of ["snare", "toms", "roll", "stop"] as FillStyle[]) {
      const hits = drumHits(rock(style), 8)
      expect(hits.filter((h) => h.start < 6)).toEqual(
        plain.filter((h) => h.start < 6)
      )
    }
  })

  it("snare fill: four rising 16ths on the last beat", () => {
    const fill = from(drumHits(rock("snare"), 8), 7)
    const snares = fill.filter((h) => h.midi === midi.snare)
    expect(snares.map((h) => h.start)).toEqual([7, 7.25, 7.5, 7.75])
    expect(snares.map((h) => h.velocity)).toEqual([78, 92, 106, 120])
  })

  it("tom run: snare and toms over the last two beats", () => {
    const fill = from(drumHits(rock("toms"), 8), 6)
    const toms = fill.filter((h) => h.midi === midi.tom)
    expect(toms.length).toBeGreaterThanOrEqual(5)
    expect(fill.some((h) => h.midi === midi.hat)).toBe(false)
    expect(
      fill.filter((h) => h.midi === midi.kick).map((h) => h.start)
    ).toEqual([6, 7])
  })

  it("snare roll: 16ths over two beats, getting louder", () => {
    const rolls = from(drumHits(rock("roll"), 8), 6).filter(
      (h) => h.midi === midi.snare
    )
    expect(rolls).toHaveLength(8)
    for (let i = 1; i < rolls.length; i++)
      expect(rolls[i].velocity).toBeGreaterThan(rolls[i - 1].velocity)
  })

  it("drop out: silence on the last beat", () => {
    const hits = drumHits(rock("stop"), 8)
    expect(from(hits, 7)).toEqual([])
    expect(from(hits, 6).length).toBeGreaterThan(0)
  })

  it("fit sections shorter than the fill", () => {
    const hits = drumHits(rock("roll"), 1)
    expect(hits.filter((h) => h.midi === midi.snare)).toHaveLength(4)
  })
})

/** Verse–chorus song with the form A A B A and drums on in both sections. */
function song(patch: Partial<Song> = {}, sectionPatch: Partial<Section> = {}) {
  const base = EXAMPLES.find((e) => e.id === "pop")!.build()
  const [a, b] = base.sections
  let s: Song = {
    ...base,
    ...patch,
    sections: base.sections.map((x) => ({
      ...x,
      drums: { ...rock(null), crashAtStart: false },
      ...sectionPatch,
    })),
    arrangement: [],
  }
  for (const id of [a.id, a.id, b.id, a.id]) s = addSlot(s, id)
  return s
}
const crashesAt = (s: Song) =>
  buildEvents(s, ALL)
    .filter((e) => e.midi === midi.crash)
    .map((e) => e.start)

describe("crash on every new section", () => {
  it("crashes where the form changes section, not on repeats", () => {
    const s = song({ crashOnChange: true })
    const starts = layout(s).map((p) => p.start)
    expect(crashesAt(s)).toEqual([starts[2], starts[3]])
    expect(crashesAt(song())).toEqual([])
  })

  it("doesn't double a crash the section already has", () => {
    const s = song({ crashOnChange: true })
    s.sections[1].drums.crashAtStart = true
    const starts = layout(s).map((p) => p.start)
    // B still crashes once (its own), A's return crashes from the switch.
    expect(crashesAt(s)).toEqual([starts[2], starts[3]])
  })

  it("stays quiet in sections without drums", () => {
    const s = song({ crashOnChange: true })
    s.sections[1].drums.enabled = false
    const starts = layout(s).map((p) => p.start)
    expect(crashesAt(s)).toEqual([starts[3]])
  })
})

describe("build-up", () => {
  it("swells over the last bars and leaves the rest alone", () => {
    const plain = song()
    const built = song({}, { buildUp: true })
    const p = layout(plain)[0]
    const end = p.start + p.beats
    const ramp = Math.min(BUILD_UP_BEATS, p.beats / 2)
    const a = buildEvents(plain, ALL)
    const b = buildEvents(built, ALL)
    expect(b).toHaveLength(a.length)
    let louder = 0
    a.forEach((e, i) => {
      if (e.start >= end || e.start < p.start) return
      if (e.start < end - ramp) expect(b[i].velocity).toBe(e.velocity)
      else if (e.start > end - ramp / 3 && b[i].velocity > e.velocity) louder++
    })
    expect(louder).toBeGreaterThan(0)
  })
})

describe("saving fills and transitions", () => {
  it("round-trips through share links and drops defaults", async () => {
    const s = song({ crashOnChange: true }, { buildUp: true })
    s.sections[0].drums = rock("toms")
    s.sections[1].drums = rock("snare")
    const back = await decodeShare(await encodeShare(s))
    expect(back.crashOnChange).toBe(true)
    expect(back.sections[0].buildUp).toBe(true)
    expect(back.sections[0].drums.fillStyle).toBe("toms")
    expect(back.sections[1].drums.fill).toBe(true)
    expect("fillStyle" in back.sections[1].drums).toBe(false)
    const odd = normalizeSong({
      ...s,
      crashOnChange: "yes",
      sections: s.sections.map((x) => ({
        ...x,
        buildUp: 1,
        drums: { ...x.drums, fillStyle: "cowbell" },
      })),
    })
    expect(odd.crashOnChange).toBeUndefined()
    expect(odd.sections[0].buildUp).toBeUndefined()
    expect(odd.sections[0].drums.fillStyle).toBeUndefined()
  })
})
