import { describe, expect, it } from "vitest"

import {
  chordFromPitches,
  detectKey,
  foldDegree,
  keyFromSignature,
  nearestDegree,
} from "@/lib/harmony"
import { type Key, MELODY_RANGE, chordName } from "@/lib/music"

const C_MAJOR: Key = { root: 0, scale: "major" }
const G_MIXO: Key = { root: 7, scale: "mixolydian" }

const name = (pitches: number[], key: Key) => {
  const g = chordFromPitches(pitches, key)!
  return chordName(g, key)
}

describe("chordFromPitches", () => {
  it("recognises chords played on a keyboard", () => {
    expect(name([60, 64, 67], C_MAJOR)).toBe("C")
    expect(name([57, 60, 64], C_MAJOR)).toBe("Am")
    expect(name([55, 59, 62, 65], C_MAJOR)).toBe("G7")
    expect(name([60, 65, 67], C_MAJOR)).toBe("Csus4")
    expect(name([62, 65, 69, 72], C_MAJOR)).toBe("Dm7")
  })

  it("works out inversions from the lowest note", () => {
    expect(name([64, 67, 72], C_MAJOR)).toBe("C/E")
    expect(name([55, 60, 64], C_MAJOR)).toBe("C/G")
  })

  it("builds the in-key triad from a single key", () => {
    expect(name([62], C_MAJOR)).toBe("Dm")
    expect(name([65, 77], C_MAJOR)).toBe("F") // octaves count as one note
    expect(name([65], G_MIXO)).toBe("F")
  })

  it("returns null for no notes", () => {
    expect(chordFromPitches([], C_MAJOR)).toBeNull()
  })
})

describe("scale degrees", () => {
  it("finds the nearest degree, rounding out-of-key notes down", () => {
    expect(nearestDegree(72, C_MAJOR)).toBe(7) // C5 is the melody's upper tonic
    expect(nearestDegree(74, C_MAJOR)).toBe(8)
    expect(nearestDegree(73, C_MAJOR)).toBe(7) // C♯ → C
    expect(nearestDegree(59, C_MAJOR)).toBe(-1)
  })

  it("folds degrees into the grid by octaves", () => {
    expect(foldDegree(-1)).toBe(6)
    expect(foldDegree(MELODY_RANGE)).toBe(MELODY_RANGE - 7)
    expect(foldDegree(3)).toBe(3)
  })
})

describe("keys", () => {
  it("reads MIDI key signatures", () => {
    expect(keyFromSignature(0, false)).toEqual(C_MAJOR)
    expect(keyFromSignature(0, true)).toEqual({ root: 9, scale: "minor" })
    expect(keyFromSignature(-3, false)).toEqual({ root: 3, scale: "major" })
    expect(keyFromSignature(2, true)).toEqual({ root: 11, scale: "minor" })
  })

  it("detects major and minor keys from note weights", () => {
    const weights = (pcs: number[], tonic: number) => {
      const w = Array<number>(12).fill(0)
      for (const pc of pcs) w[pc] += 1
      w[tonic] += 3
      w[(tonic + 7) % 12] += 1.5
      return w
    }
    expect(detectKey(weights([0, 2, 4, 5, 7, 9, 11], 0))).toEqual(C_MAJOR)
    expect(detectKey(weights([9, 11, 0, 2, 4, 5, 7], 9))).toEqual({
      root: 9,
      scale: "minor",
    })
    expect(detectKey(weights([7, 9, 11, 0, 2, 4, 6], 7))).toEqual({
      root: 7,
      scale: "major",
    })
  })
})
