import { describe, expect, it } from "vitest"

import {
  DRUM_PIECES,
  DRUM_PRESETS,
  type DrumSettings,
  drumHits,
  emptyPattern,
  matchingPreset,
  presetPattern,
} from "@/lib/drums"

const KICK = 36
const SNARE = 38
const HAT = 42
const OPEN_HAT = 46
const CRASH = 49

const settings = (patch: Partial<DrumSettings> = {}): DrumSettings => ({
  enabled: true,
  pattern: presetPattern("pop"),
  fill: false,
  crashAtStart: false,
  ...patch,
})

describe("drum patterns", () => {
  it("has a full 16-step row for every piece in every preset", () => {
    for (const p of DRUM_PRESETS)
      for (const piece of DRUM_PIECES)
        expect(p.pattern[piece.id]).toHaveLength(16)
  })

  it("recognises presets and returns independent copies", () => {
    const pop = presetPattern("pop")
    expect(matchingPreset(pop)).toBe("pop")
    pop.kick[1] = 1
    expect(matchingPreset(pop)).toBeNull()
    expect(presetPattern("pop").kick[1]).toBe(0)
    expect(matchingPreset(emptyPattern())).toBeNull()
  })
})

describe("drumHits", () => {
  it("repeats the bar across the song", () => {
    const one = drumHits(settings(), 4)
    const four = drumHits(settings(), 16)
    expect(four).toHaveLength(one.length * 4)
    const kicks = four.filter((h) => h.midi === KICK).map((h) => h.start)
    expect(kicks).toEqual(
      [0, 1.5, 2, 2.5]
        .flatMap((b) => [b, b + 4, b + 8, b + 12])
        .sort((a, b) => a - b)
    )
  })

  it("accents louder than normal hits", () => {
    const hats = drumHits(settings(), 4).filter((h) => h.midi === HAT)
    const accent = hats.find((h) => h.start === 0)!
    const normal = hats.find((h) => h.start === 0.5)!
    expect(accent.velocity).toBeGreaterThan(normal.velocity)
  })

  it("lets an open hat replace the closed hat on the same step", () => {
    const pattern = emptyPattern()
    pattern.hat[2] = 1
    pattern.openhat[2] = 1
    const hits = drumHits(settings({ pattern }), 4)
    expect(hits.map((h) => h.midi)).toEqual([OPEN_HAT])
  })

  it("adds a rising snare fill over the last beat", () => {
    const hits = drumHits(settings({ fill: true }), 8)
    const last = hits.filter((h) => h.start >= 7)
    const snares = last.filter((h) => h.midi === SNARE)
    expect(snares.map((h) => h.start)).toEqual([7, 7.25, 7.5, 7.75])
    for (let i = 1; i < snares.length; i++)
      expect(snares[i].velocity).toBeGreaterThan(snares[i - 1].velocity)
    expect(last.filter((h) => h.midi === HAT)).toHaveLength(0)
  })

  it("adds one crash at the start when asked", () => {
    expect(drumHits(settings(), 8).some((h) => h.midi === CRASH)).toBe(false)
    const crashes = drumHits(settings({ crashAtStart: true }), 8).filter(
      (h) => h.midi === CRASH
    )
    expect(crashes.map((h) => h.start)).toEqual([0])
  })

  it("plays nothing for an empty pattern or an empty song", () => {
    expect(drumHits(settings({ pattern: emptyPattern() }), 16)).toEqual([])
    expect(drumHits(settings({ crashAtStart: true }), 0)).toEqual([])
  })
})
