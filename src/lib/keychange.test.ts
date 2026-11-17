import { describe, expect, it } from "vitest"

import { type Song, buildEvents, keyChanges, layout } from "@/lib/arrange"
import { bassLine } from "@/lib/bass"
import { EXAMPLES } from "@/lib/examples"
import { chordFromPitches } from "@/lib/harmony"
import { buildMidi } from "@/lib/midi"
import {
  type Chord,
  type Key,
  chordMidi,
  chordName,
  degreeToMidi,
  keyLabel,
  keySignature,
  melodyBase,
  sectionKey,
  voiceChords,
} from "@/lib/music"
import { addSlot } from "@/lib/sections"

const F: Key = { root: 5, scale: "major" }
const A: Key = { root: 9, scale: "minor" }
const chord = (c: Partial<Chord>): Chord => ({
  id: "x",
  degree: 0,
  type: "triad",
  inversion: 0,
  beats: 4,
  ...c,
})

describe("a section's key", () => {
  it("is named after the new tonic", () => {
    expect(keyLabel(sectionKey(F, 2))).toBe("G Major")
    expect(keyLabel(sectionKey(F, -1))).toBe("E Major")
    expect(keyLabel(sectionKey(A, 3))).toBe("C Natural Minor")
    expect(sectionKey(F, 0)).toBe(F)
  })

  it("builds every chord exactly the key change higher, in the same register", () => {
    // F + 2 = G crosses the point where the register would drop an octave.
    for (const key of [F, A, { root: 11, scale: "dorian" } as Key])
      for (const t of [-5, -1, 1, 2, 5, 6]) {
        const moved = sectionKey(key, t)
        for (let degree = 0; degree < 7; degree++)
          for (const extra of [
            {},
            { type: "seventh" as const, inversion: 2 },
            { type: "seventh" as const, secondary: true },
            { mode: "minor" as const },
          ]) {
            const c = chord({ degree, ...extra })
            expect(chordMidi(c, moved)).toEqual(
              chordMidi(c, key).map((m) => m + t)
            )
          }
        for (let d = -3; d < 15; d++)
          expect(degreeToMidi(d, moved, melodyBase(moved))).toBe(
            degreeToMidi(d, key, melodyBase(key)) + t
          )
      }
  })

  it("names chords in the new key", () => {
    const g = sectionKey(F, 2)
    const prog = [0, 4, 5, 3].map((degree) => chord({ degree }))
    expect(prog.map((c) => chordName(c, g))).toEqual(["G", "D", "Em", "C"])
    // B♭ major − 1 = A major: sharps now, not flats.
    const a = sectionKey({ root: 10, scale: "major" }, -1)
    expect(chordName(chord({ degree: 2 }), a)).toBe("C♯m")
  })

  it("voices and bass lines match what plays", () => {
    const prog = [0, 5, 3, 4].map((degree, i) =>
      chord({ id: String(i), degree, type: "seventh" })
    )
    const moved = sectionKey(F, 2)
    const a = voiceChords(prog, F, true)
    const b = voiceChords(prog, moved, true)
    expect(b.map((v) => v.inversion)).toEqual(a.map((v) => v.inversion))
    expect(b.map((v) => v.notes)).toEqual(
      a.map((v) => v.notes.map((m) => m + 2))
    )
    expect(bassLine(prog, moved, "walking").map((n) => n.midi)).toEqual(
      bassLine(prog, F, "walking").map((n) => n.midi + 2)
    )
  })

  it("reads keyboard chords in the section's key", () => {
    // A D major triad in a G section (F + 2) is the V chord.
    const g = chordFromPitches([50, 54, 57], sectionKey(F, 2))!
    expect(g.degree).toBe(4)
    expect(g.mode).toBeUndefined()
  })
})

/** Pop example with the form A A B A and the last A lifted. */
function lifted(): Song {
  const base = EXAMPLES.find((e) => e.id === "pop")!.build()
  const [a, b] = base.sections
  let s: Song = { ...base, arrangement: [] }
  for (const id of [a.id, a.id, b.id]) s = addSlot(s, id)
  // The last chorus is a copy of A, two semitones up.
  const up = { ...a, id: "up", name: "Last chorus", transpose: 2 }
  s = { ...s, sections: [...s.sections, up] }
  return addSlot(s, "up")
}

describe("key changes in the MIDI export", () => {
  it("lists a key signature where the key changes", () => {
    const s = lifted()
    const placed = layout(s)
    const last = placed[placed.length - 1]
    expect(keyChanges(s.key, placed)).toEqual([
      { beat: last.start, ...keySignature(sectionKey(s.key, 2)) },
    ])
    // Back down again after it.
    const again = addSlot(s, s.sections[0].id)
    const changes = keyChanges(again.key, layout(again))
    expect(changes).toHaveLength(2)
    expect(changes[1]).toMatchObject(keySignature(again.key))
  })

  it("writes them into the conductor track", () => {
    const s = lifted()
    const placed = layout(s)
    const bytes = buildMidi(
      buildEvents(s, { chords: true, melody: true, bass: true, drums: true }),
      {
        bpm: s.bpm,
        title: s.title,
        keySig: keySignature(s.key),
        keyChanges: keyChanges(s.key, placed),
      }
    )
    let count = 0
    for (let i = 0; i < bytes.length - 2; i++)
      if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 2)
        count++
    expect(count).toBe(2)
  })

  it("plays the lifted section a whole step up", () => {
    const s = lifted()
    const placed = layout(s)
    const last = placed[placed.length - 1]
    const first = placed[0]
    const ev = buildEvents(s, {
      chords: true,
      melody: false,
      bass: false,
      drums: false,
    })
    const at = (from: number, to: number) =>
      ev.filter((e) => e.start >= from && e.start < to).map((e) => e.midi)
    expect(at(last.start, last.start + last.beats)).toEqual(
      at(first.start, first.start + first.beats).map((m) => m + 2)
    )
  })
})
