import { describe, expect, it } from "vitest"

import { EXAMPLES } from "@/lib/examples"
import { METERS, meterOf } from "@/lib/meter"
import { CHORD_STYLES, type ChordHit, STRUM_GAP, chordHits } from "@/lib/rhythm"
import { normalizeSong } from "@/lib/song-file"

const C = [60, 64, 67]
const four = meterOf("4/4")
const starts = (hits: ChordHit[]) =>
  [...new Set(hits.map((h) => Math.round(h.start * 100) / 100))].sort(
    (a, b) => a - b
  )
const at = (hits: ChordHit[], start: number) =>
  hits
    .filter((h) => Math.abs(h.start - start) < 0.1)
    .sort((a, b) => a.start - b.start)
    .map((h) => h.midi)

describe("chord rhythm patterns", () => {
  it("strums down, down-up, up-down-up in 4/4", () => {
    const hits = chordHits("strum", C, 0, 4, four)
    const strokes = [0, 1, 1.5, 2.5, 3, 3.5]
    // Each stroke's notes are a few ms apart.
    expect(starts(hits)).toEqual(
      strokes.flatMap((s) => [s, s + STRUM_GAP, s + 2 * STRUM_GAP])
    )
    expect(at(hits, 0)).toEqual([60, 64, 67]) // down: low to high
    expect(at(hits, 1.5)).toEqual([67, 64, 60]) // up: high to low
    // Up strums are softer.
    const vel = (s: number) => hits.find((h) => h.start === s)!.velocity
    expect(vel(1.5)).toBeLessThan(vel(1))
  })

  it("strums each beat of three in 6/8", () => {
    const hits = chordHits("strum", C, 0, 3, meterOf("6/8"))
    const firsts = starts(hits).filter(
      (s) => Math.abs(s * 2 - Math.round(s * 2)) < 1e-6
    )
    expect(firsts).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
    expect(at(hits, 1.5)).toEqual([60, 64, 67]) // beat 2 is a down strum
  })

  it("skanks on the off-beats, short", () => {
    const hits = chordHits("offbeat", C, 0, 4, four)
    expect(starts(hits)).toEqual([0.5, 1.5, 2.5, 3.5])
    expect(Math.max(...hits.map((h) => h.duration))).toBeLessThanOrEqual(0.3)
    expect(starts(chordHits("offbeat", C, 0, 3, meterOf("6/8")))).toEqual([
      0.5, 1, 2, 2.5,
    ])
  })

  it("plays the Charleston in every bar", () => {
    expect(starts(chordHits("charleston", C, 0, 8, four))).toEqual([
      0, 1.5, 4, 5.5,
    ])
    // A chord that starts mid-bar, between hits, still sounds.
    expect(starts(chordHits("charleston", C, 2, 2, four))).toEqual([2])
  })

  it("plays oom-pah-pah in 3/4 and 6/8", () => {
    const waltz = chordHits("oompah", C, 0, 3, meterOf("3/4"))
    expect(starts(waltz)).toEqual([0, 1, 2])
    expect(at(waltz, 0)).toEqual([60])
    expect(at(waltz, 1)).toEqual([64, 67])
    const jig = chordHits("oompah", C, 0, 3, meterOf("6/8"))
    expect(starts(jig)).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
    expect(at(jig, 1.5)).toEqual([60])
  })

  it("keeps every note inside its chord, in every time signature", () => {
    for (const m of METERS)
      for (const { value } of CHORD_STYLES) {
        const hits = chordHits(value, [62, 57, 65], 1.5, 5, m)
        expect(hits.length, `${value} in ${m.id}`).toBeGreaterThan(0)
        for (const h of hits) {
          expect(h.start).toBeGreaterThanOrEqual(1.5)
          expect(h.start + h.duration).toBeLessThanOrEqual(6.5 + 1e-9)
          expect(h.velocity).toBeGreaterThan(0)
        }
      }
  })

  it("is saved with the song and its sections", () => {
    const song = EXAMPLES[0].build()
    song.chordStyle = "strum"
    song.sections[0].chordStyle = "oompah"
    const loaded = normalizeSong(JSON.parse(JSON.stringify(song)))
    expect(loaded.chordStyle).toBe("strum")
    expect(loaded.sections[0].chordStyle).toBe("oompah")
    expect(normalizeSong({ ...song, chordStyle: "funk" }).chordStyle).toBe(
      "block"
    )
  })
})
