import { describe, expect, it } from "vitest"

import { LEAD_IN_STEPS, borrowMelody, leadInto } from "@/lib/melody-links"
import {
  type Chord,
  MELODY_RANGE,
  type MelodyNote,
  chordToneClasses,
} from "@/lib/music"

const chords = (...degrees: number[]): Chord[] =>
  degrees.map((degree, i) => ({
    id: `c${i}`,
    degree,
    type: "triad",
    inversion: 0,
    beats: 4,
  }))
const note = (
  start: number,
  degree: number,
  length = 2,
  locked?: boolean
): MelodyNote => ({
  id: `n${start}`,
  start,
  length,
  degree,
  ...(locked ? { locked } : {}),
})
const opts = { density: 0.5, seed: 7 }
const shape = (m: MelodyNote[]) => m.map((n) => [n.start, n.length, n.degree])
const rhythm = (m: MelodyNote[]) => m.map((n) => [n.start, n.length])

// A verse over I–V (two bars): a phrase of quarter notes.
const verse = {
  chords: chords(0, 4),
  melody: [note(0, 7), note(2, 8), note(4, 9), note(8, 11), note(12, 9, 4)],
}

describe("melody from another section", () => {
  it("copies the same notes, repeating a shorter source to fill", () => {
    const chorus = { chords: chords(3, 4, 0, 5), melody: [] }
    const out = borrowMelody(verse, chorus, "copy", opts)
    expect(shape(out)).toEqual([
      ...shape(verse.melody),
      ...shape(verse.melody).map(([s, l, d]) => [s + 16, l, d]),
    ])
  })

  it("cuts a longer source off at the end of the section", () => {
    const short = {
      chords: chords(0).map((c) => ({ ...c, beats: 6 })),
      melody: [],
    }
    const out = borrowMelody(verse, short, "copy", opts)
    expect(shape(out)).toEqual([
      [0, 2, 7],
      [2, 2, 8],
      [4, 2, 9],
      [8, 2, 11],
    ])
    expect(out.every((n) => n.start + n.length <= 12)).toBe(true)
  })

  it("follows the chords: moves each note by the change of chord under it", () => {
    // Bar 1 is IV instead of I (+3), bar 2 is vi instead of V (+1).
    const target = { chords: chords(3, 5), melody: [] }
    const out = borrowMelody(verse, target, "follow", opts)
    expect(shape(out)).toEqual([
      [0, 2, 10],
      [2, 2, 11],
      [4, 2, 12],
      [8, 2, 12],
      [12, 4, 10],
    ])
    // I → V goes down a fourth (the nearer way), and stays in range.
    const down = borrowMelody(
      verse,
      { chords: chords(4, 4), melody: [] },
      "follow",
      opts
    )
    expect(down[0].degree).toBe(4)
    expect(down.every((n) => n.degree >= 0 && n.degree < MELODY_RANGE)).toBe(
      true
    )
  })

  it("keeps the rhythm but writes new notes over the target chords", () => {
    const target = { chords: chords(5, 3), melody: [] }
    const out = borrowMelody(verse, target, "rhythm", opts)
    expect(rhythm(out)).toEqual(rhythm(verse.melody))
    // Strong beats land on chord tones of vi and IV; it ends on a tonic.
    for (const n of out.slice(0, -1)) {
      const chord = n.start < 8 ? target.chords[0] : target.chords[1]
      expect(chordToneClasses(chord)).toContain(n.degree % 7)
    }
    expect(out[out.length - 1].degree % 7).toBe(0)
    // Same seed, same tune.
    expect(shape(borrowMelody(verse, target, "rhythm", opts))).toEqual(
      shape(out)
    )
  })

  it("keeps the target's locked notes", () => {
    const locked = note(6, 3, 2, true)
    const out = borrowMelody(
      verse,
      { chords: chords(0, 4), melody: [locked, note(10, 1)] },
      "copy",
      opts
    )
    expect(out).toContainEqual(locked)
    expect(out.some((n) => n.start === 10 && n.degree === 1)).toBe(false)
    // Notes that ran into the locked one are shortened, none overlap it.
    expect(
      out
        .filter((n) => n !== locked)
        .every((n) => n.start + n.length <= 6 || n.start >= 8)
    ).toBe(true)
  })

  it("does nothing without a source melody", () => {
    const target = { chords: chords(0), melody: [note(0, 3)] }
    expect(
      borrowMelody({ chords: chords(0), melody: [] }, target, "copy", opts)
    ).toBe(target.melody)
  })
})

describe("leading into the next section", () => {
  const end = 16 // two bars of 8 steps

  it("steps down into a lower next note", () => {
    const out = leadInto(verse.melody, verse.chords, 7)!
    const run = out.filter((n) => n.start >= end - LEAD_IN_STEPS)
    expect(shape(run)).toEqual([
      [13, 1, 10],
      [14, 1, 9],
      [15, 1, 8],
    ])
    // The held note before it is shortened to make room.
    expect(out.find((n) => n.start === 12)!.length).toBe(1)
  })

  it("steps up into a higher next note", () => {
    const low = [note(0, 2), note(8, 3, 8)]
    const out = leadInto(low, verse.chords, 9)!
    expect(shape(out.filter((n) => n.start >= 13)).map((x) => x[2])).toEqual([
      6, 7, 8,
    ])
  })

  it("turns around at the edges of the range", () => {
    const out = leadInto([note(0, 5)], verse.chords, 1)!
    expect(out.filter((n) => n.start >= 13).map((n) => n.degree)).toEqual([
      4, 3, 2,
    ])
  })

  it("won't overwrite a locked note or squeeze a tiny section", () => {
    expect(leadInto([note(14, 4, 2, true)], verse.chords, 7)).toBeNull()
    const tiny = chords(0).map((c) => ({ ...c, beats: 2 }))
    expect(leadInto([], tiny, 7)).toBeNull()
  })
})
