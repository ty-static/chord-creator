import { describe, expect, it } from "vitest"

import {
  type Chord,
  type ChordType,
  type Key,
  MELODY_RANGE,
  type MelodyNote,
  STEPS_PER_BAR,
  chordMidi,
  chordName,
  clearBar,
  degreeToMidi,
  generateAroundLocked,
  generateMelody,
  keyLabel,
  keySignature,
  lockBar,
  melodyBase,
  overlay,
  regenerateBar,
  repeatBar,
  romanNumeral,
  totalBeats,
  voiceChords,
} from "@/lib/music"

const C_MAJOR: Key = { root: 0, scale: "major" }
const A_MINOR: Key = { root: 9, scale: "minor" }

let n = 0
const chord = (
  degree: number,
  type: ChordType = "triad",
  inversion = 0,
  beats = 4
): Chord => ({ id: `c${n++}`, degree, type, inversion, beats })

const progression = (degrees: number[]) => degrees.map((d) => chord(d))

/** The melody is monophonic: no two notes overlap in time. */
function expectMonophonic(melody: MelodyNote[]) {
  const sorted = [...melody].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++)
    expect(sorted[i - 1].start + sorted[i - 1].length).toBeLessThanOrEqual(
      sorted[i].start
    )
}

const inBar = (melody: MelodyNote[], bar: number) =>
  melody
    .filter(
      (m) =>
        m.start >= bar * STEPS_PER_BAR && m.start < (bar + 1) * STEPS_PER_BAR
    )
    .sort((a, b) => a.start - b.start)

describe("keys and scales", () => {
  it("maps scale degrees to MIDI notes, across octaves", () => {
    const base = 60
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7].map((d) => degreeToMidi(d, C_MAJOR, base))
    ).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
    expect(degreeToMidi(-1, C_MAJOR, base)).toBe(59)
    expect(degreeToMidi(2, A_MINOR, 57)).toBe(60) // C, the minor third of A
  })

  it("gives the right key signatures", () => {
    expect(keySignature(C_MAJOR)).toEqual({ sf: 0, minor: false })
    expect(keySignature({ root: 7, scale: "major" })).toEqual({
      sf: 1,
      minor: false,
    })
    expect(keySignature({ root: 5, scale: "major" })).toEqual({
      sf: -1,
      minor: false,
    })
    expect(keySignature(A_MINOR)).toEqual({ sf: 0, minor: true })
    expect(keySignature({ root: 2, scale: "dorian" })).toEqual({
      sf: 0,
      minor: true,
    })
    expect(keySignature({ root: 7, scale: "mixolydian" }).sf).toBe(0)
  })

  it("spells flats in flat keys and sharps in sharp keys", () => {
    expect(keyLabel({ root: 10, scale: "major" })).toBe("B♭ Major")
    expect(keyLabel({ root: 6, scale: "major" })).toBe("F♯ Major")
  })
})

describe("chords", () => {
  it("names diatonic triads and sevenths", () => {
    const names = [0, 1, 2, 3, 4, 5, 6].map((d) => chordName(chord(d), C_MAJOR))
    expect(names).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"])
    const sevenths = [0, 1, 4, 6].map((d) =>
      chordName(chord(d, "seventh"), C_MAJOR)
    )
    expect(sevenths).toEqual(["Cmaj7", "Dm7", "G7", "Bm7♭5"])
    expect(chordName(chord(0, "sus4"), C_MAJOR)).toBe("Csus4")
    expect(chordName(chord(0, "sus2"), C_MAJOR)).toBe("Csus2")
  })

  it("writes slash chords for inversions", () => {
    expect(chordName(chord(0, "triad", 1), C_MAJOR)).toBe("C/E")
    expect(chordName(chord(0, "triad", 2), C_MAJOR)).toBe("C/G")
  })

  it("gives Roman numerals with quality", () => {
    expect(romanNumeral(chord(0), C_MAJOR)).toBe("I")
    expect(romanNumeral(chord(1), C_MAJOR)).toBe("ii")
    expect(romanNumeral(chord(6), C_MAJOR)).toBe("vii°")
    expect(romanNumeral(chord(4, "seventh"), C_MAJOR)).toBe("V7")
    expect(romanNumeral(chord(0, "seventh"), C_MAJOR)).toBe("Imaj7")
    expect(romanNumeral(chord(0), A_MINOR)).toBe("i")
  })

  it("inverts by moving the lowest notes up an octave", () => {
    const root = chordMidi(chord(0), C_MAJOR)
    const first = chordMidi(chord(0, "triad", 1), C_MAJOR)
    expect(first).toEqual([root[1], root[2], root[0] + 12])
    expect(chordMidi(chord(0, "seventh"), C_MAJOR)).toHaveLength(4)
  })

  it("adds up chord lengths", () => {
    expect(totalBeats([chord(0, "triad", 0, 4), chord(4, "triad", 0, 2)])).toBe(
      6
    )
  })
})

describe("voice leading", () => {
  const prog = progression([0, 4, 5, 3])
  const movement = (smooth: boolean) => {
    const v = voiceChords(prog, C_MAJOR, smooth)
    let total = 0
    for (let i = 1; i < v.length; i++)
      for (const note of v[i].notes)
        total += Math.min(...v[i - 1].notes.map((m) => Math.abs(m - note)))
    return total
  }

  it("keeps root position when off", () => {
    const v = voiceChords(prog, C_MAJOR, false)
    expect(v.map((x) => x.inversion)).toEqual([0, 0, 0, 0])
    expect(v[1].notes).toEqual(chordMidi(prog[1], C_MAJOR))
  })

  it("moves less between chords when on, with the same pitch classes", () => {
    expect(movement(true)).toBeLessThan(movement(false))
    const on = voiceChords(prog, C_MAJOR, true)
    const off = voiceChords(prog, C_MAJOR, false)
    on.forEach((v, i) =>
      expect(new Set(v.notes.map((m) => m % 12))).toEqual(
        new Set(off[i].notes.map((m) => m % 12))
      )
    )
    for (const v of on)
      for (const m of v.notes) {
        expect(m).toBeGreaterThanOrEqual(40)
        expect(m).toBeLessThanOrEqual(81)
      }
  })
})

describe("melody generation", () => {
  const prog = progression([0, 4, 5, 3])
  const steps = totalBeats(prog) * 2

  it("is deterministic for a seed", () => {
    const a = generateMelody(prog, { density: 0.5, seed: 42 })
    const b = generateMelody(prog, { density: 0.5, seed: 42 })
    const shape = (m: MelodyNote[]) =>
      m.map((x) => [x.start, x.length, x.degree])
    expect(shape(a)).toEqual(shape(b))
    expect(a[0].id).not.toBe(b[0].id) // fresh ids each time
  })

  it("stays monophonic, in range and inside the song", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const mel = generateMelody(prog, { density: seed / 25, seed })
      expectMonophonic(mel)
      for (const note of mel) {
        expect(note.degree).toBeGreaterThanOrEqual(0)
        expect(note.degree).toBeLessThan(MELODY_RANGE)
        expect(note.length).toBeGreaterThanOrEqual(1)
        expect(note.start + note.length).toBeLessThanOrEqual(steps)
      }
    }
  })

  it("ends on a tonic", () => {
    const mel = generateMelody(prog, { density: 0.6, seed: 9 })
    expect([0, 7, 14]).toContain(mel[mel.length - 1].degree)
  })

  it("plays a note at the start of every chord most of the time", () => {
    const mel = generateMelody(prog, { density: 0.5, seed: 3 })
    const starts = new Set(mel.map((m) => m.start))
    const hits = [0, 8, 16, 24].filter((s) => starts.has(s)).length
    expect(hits).toBeGreaterThanOrEqual(3)
  })
})

describe("bar tools", () => {
  const prog = progression([0, 3, 4, 0]) // I IV V I
  const melody = generateMelody(prog, { density: 0.6, seed: 5 })

  it("overlay trims and drops notes under the top layer", () => {
    const base: MelodyNote[] = [
      { id: "a", start: 0, length: 6, degree: 3 },
      { id: "b", start: 4, length: 2, degree: 4 },
      { id: "c", start: 8, length: 2, degree: 5 },
    ]
    const top: MelodyNote[] = [{ id: "t", start: 3, length: 3, degree: 9 }]
    const out = overlay(base, top)
    expect(out.map((m) => [m.id, m.start, m.length])).toEqual([
      ["a", 0, 3],
      ["t", 3, 3],
      ["c", 8, 2],
    ])
  })

  it("regenerating a bar leaves every other bar alone", () => {
    const out = regenerateBar(melody, prog, 2, { density: 0.6, seed: 999 })
    for (const bar of [0, 1, 3])
      expect(inBar(out, bar)).toEqual(inBar(melody, bar))
    expectMonophonic(out)
  })

  it("clearing a bar keeps locked notes", () => {
    const locked = lockBar(melody, prog, 1, true)
    const keep = inBar(locked, 1)[0]
    const out = clearBar(
      locked.map((m) => (m.id === keep.id ? m : { ...m, locked: false })),
      prog,
      1
    )
    expect(inBar(out, 1).map((m) => m.id)).toEqual([keep.id])
  })

  it("repeats a motif exactly or following the chords", () => {
    const motif = inBar(melody, 0).map((m) => [m.start, m.degree])
    const exact = repeatBar(melody, prog, 0, [0, 1, 2, 3], false)
    for (const bar of [1, 2, 3])
      expect(
        inBar(exact, bar).map((m) => [m.start - bar * 8, m.degree])
      ).toEqual(motif)

    const follow = repeatBar(melody, prog, 0, [1, 2], true)
    // I→IV moves the motif up three scale steps; I→V the nearest way, down
    // three. Notes only jump an octave if they'd leave the grid.
    const moved = (bar: number, by: number) =>
      inBar(melody, 0).map((m) => {
        let d = m.degree + by
        while (d > MELODY_RANGE - 1) d -= 7
        while (d < 0) d += 7
        return [m.start + bar * STEPS_PER_BAR, d]
      })
    expect(inBar(follow, 1).map((m) => [m.start, m.degree])).toEqual(
      moved(1, 3)
    )
    expect(inBar(follow, 2).map((m) => [m.start, m.degree])).toEqual(
      moved(2, -3)
    )
    expectMonophonic(follow)
  })

  it("never overwrites locked notes", () => {
    const locked = lockBar(melody, prog, 1, true)
    const lockedIds = inBar(locked, 1).map((m) => m.id)
    const repeated = repeatBar(locked, prog, 0, [1], false)
    const regenerated = generateAroundLocked(locked, prog, {
      density: 0.6,
      seed: 77,
    })
    for (const out of [repeated, regenerated]) {
      for (const id of lockedIds)
        expect(out.some((m) => m.id === id)).toBe(true)
      expectMonophonic(out)
    }
  })

  it("puts the melody tonic an octave above the chord tonic", () => {
    expect(melodyBase(C_MAJOR) % 12).toBe(0)
    expect(melodyBase(A_MINOR) % 12).toBe(9)
  })
})
