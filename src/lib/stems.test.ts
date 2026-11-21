import { describe, expect, it } from "vitest"

import { guessKey, guessRoles, midiToSong } from "@/lib/midi-import"
import {
  HAT,
  KICK,
  SNARE,
  STEM_RATE as SR,
  alignToBeat,
  drumHits,
  oneLine,
  twoGroups,
  smoothLine,
  withoutBleed,
  songTempo,
  stemsToEvents,
  stemsToParsedMidi,
} from "@/lib/stems"

/** A seeded random, so the noise is the same every run. */
function random(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 - 0.5
  }
}

const rand = random()
const kick = (n: number) =>
  Float32Array.from({ length: n }, (_, i) => {
    const t = i / SR
    return (
      0.9 *
      Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 40)) * t) *
      Math.exp(-t * 18)
    )
  })
const snare = (n: number) =>
  Float32Array.from({ length: n }, (_, i) => {
    const t = i / SR
    return (
      (0.6 * rand() + 0.3 * Math.sin(2 * Math.PI * 1800 * t)) *
      Math.exp(-t * 25)
    )
  })
/** Bright noise: rough differences of white noise. */
const hat = (n: number) => {
  let prev = 0
  return Float32Array.from({ length: n }, (_, i) => {
    const v = rand()
    const out = (v - prev) * 0.5 * Math.exp((-i / SR) * 60)
    prev = v
    return out
  })
}

/** A drum beat: kick on 1 and 3, snare on 2 and 4, hats on the 8ths. */
function beat(bpm: number, bars: number, lead = 0) {
  const beatLen = 60 / bpm
  const out = new Float32Array(Math.round((lead + bars * 4 * beatLen + 1) * SR))
  const add = (sound: Float32Array, at: number) => {
    const i0 = Math.round(at * SR)
    for (let i = 0; i < sound.length && i0 + i < out.length; i++)
      out[i0 + i] += sound[i]
  }
  for (let b = 0; b < bars * 4; b++) {
    const t = lead + b * beatLen
    add(b % 2 === 0 ? kick(0.3 * SR) : snare(0.2 * SR), t)
    add(hat(0.05 * SR), t)
    add(hat(0.05 * SR), t + beatLen / 2)
  }
  return out
}

describe("song to MIDI", () => {
  it("hears kicks, snares and hi-hats in a drum stem", () => {
    const hits = drumHits(beat(100, 4))
    const count = (p: number) => hits.filter((h) => h.pitch === p).length
    // 16 beats: 8 kicks, 8 snares, and hats between the beats.
    expect(count(KICK)).toBeGreaterThanOrEqual(7)
    expect(count(KICK)).toBeLessThanOrEqual(9)
    expect(count(SNARE)).toBeGreaterThanOrEqual(7)
    expect(count(SNARE)).toBeLessThanOrEqual(9)
    // (Hats on a snare beat are heard as part of the snare.)
    expect(count(HAT)).toBeGreaterThanOrEqual(20)
    // The first kick is right at the start.
    expect(hits.find((h) => h.pitch === KICK)!.start).toBeLessThan(0.03)
    expect(drumHits(new Float32Array(SR))).toEqual([])
    // Hits fall into bright and full groups by the recording's own measure.
    expect(twoGroups([-2, -1.8, -2.1, 1, 1.2, 0.9])).toBeCloseTo(-0.47, 1)
    expect(twoGroups([0.1, 0.2, 0.15, 0.3])).toBe(-Infinity) // all snares
    expect(twoGroups([-1, -1.1, -0.9, -1.2])).toBe(Infinity) // all hats
  })

  it("finds the tempo and where the beats fall", () => {
    const hits = drumHits(beat(100, 8, 0.25))
    const stems = [
      { id: "drums" as const, audio: new Float32Array(), notes: hits },
    ]
    const { bpm, offset } = songTempo(stems, 21)
    expect(bpm).toBe(100)
    expect(offset).toBeCloseTo(0.25, 1)
    // Moved so the beats land on the bars: the first kick on the first beat.
    const aligned = alignToBeat(hits, bpm, offset)
    expect(aligned.find((h) => h.pitch === KICK)!.start).toBeCloseTo(0, 1)
    // A beat found late in the beat moves the notes later instead.
    const late = alignToBeat(
      [{ pitch: 60, start: 0.5, end: 1, velocity: 90 }],
      100,
      0.5
    )
    expect(late[0].start).toBeCloseTo(0.6, 5)
  })

  it("keeps a voice to one note at a time", () => {
    const n = (pitch: number, start: number, end: number, velocity = 90) => ({
      pitch,
      start,
      end,
      velocity,
    })
    expect(
      oneLine([
        n(60, 0, 1),
        n(72, 0.01, 0.9, 100), // together: the louder stays
        n(64, 0.5, 1.5), // overlaps: the earlier stops
        n(76, 0.6, 0.8, 40), // much quieter inside: an overtone
      ]).map((x) => [x.pitch, x.start, x.end])
    ).toEqual([
      [72, 0.01, 0.5],
      [64, 0.5, 1.5],
    ])
  })

  it("makes a MIDI song the importer understands", () => {
    const note = (pitch: number, start: number) => ({
      pitch,
      start,
      end: start + 0.5,
      velocity: 90,
    })
    const stems = [
      { id: "vocals" as const, notes: [note(67, 0), note(69, 0.5)] },
      { id: "other" as const, notes: [note(60, 0), note(64, 0), note(67, 0)] },
      { id: "bass" as const, notes: [note(36, 0)] },
      {
        id: "drums" as const,
        notes: [note(KICK, 0), note(SNARE, 0.5), note(HAT, 0.25)],
      },
    ]
    const midi = stemsToParsedMidi(stems, 120)
    expect(midi.parts.map((p) => p.name)).toEqual([
      "Vocals",
      "Guitars & keys",
      "Bass",
      "Drums",
    ])
    expect(midi.parts[0].notes[1]).toMatchObject({ start: 1, end: 2 })
    expect(guessRoles(midi.parts)).toEqual({
      vocals: "melody",
      other: "chords",
      bass: "bass",
      drums: "drums",
    })
    // Empty stems are left out.
    expect(stemsToParsedMidi([{ id: "vocals", notes: [] }], 120).parts).toEqual(
      []
    )
    const events = stemsToEvents(stems, 120)
    expect(new Set(events.map((e) => e.track))).toEqual(
      new Set(["melody", "chords", "bass", "drums"])
    )
  })

  it("tidies a sung line and takes the bass out of the chords", () => {
    const n = (pitch: number, start: number, end: number) => ({
      pitch,
      start,
      end,
      velocity: 90,
    })
    expect(
      smoothLine([
        n(72, 0, 0.3),
        n(72, 0.3, 0.6), // the same note, heard twice
        n(71, 0.6, 0.65), // a wobble
        n(74, 0.7, 1),
        n(76, 1.02, 1.06), // a slide into the next note
        n(77, 1.06, 1.5),
      ]).map((x) => [x.pitch, x.start, x.end])
    ).toEqual([
      [72, 0, 0.65],
      [74, 0.7, 1.06],
      [77, 1.06, 1.5],
    ])
    // The bass's own notes go; the same note an octave up is the chord's.
    const bass = [n(36, 0, 1), n(31, 1, 2)]
    expect(
      withoutBleed(
        [
          n(36, 0.01, 0.5),
          n(48, 0, 1),
          n(31, 1.02, 2),
          n(43, 1, 2),
          n(40, 0, 1),
        ],
        bass
      ).map((x) => x.pitch)
    ).toEqual([48, 43, 40])
  })

  it("reads chords timed in seconds bar by bar", () => {
    // C Am F G twice at 100 BPM, a chord on every beat. Seconds don't turn
    // into beats exactly, so a chord can start a hair before its bar.
    const chords = [
      [48, 52, 55],
      [45, 48, 52],
      [41, 45, 48],
      [43, 47, 50],
    ]
    // The bass plays roots in eighths, and is heard a little early into
    // each new bar (as a note found in a recording can be).
    const roots = [36, 33, 29, 31]
    const notes = []
    const bass = []
    for (let bar = 0; bar < 8; bar++)
      for (let b = 0; b < 4; b++) {
        const t = (bar * 4 + b) * 0.6
        for (const pitch of chords[bar % 4])
          notes.push({ pitch, start: t, end: t + 0.42, velocity: 80 })
        for (const h of [0, 0.3])
          bass.push({
            pitch: roots[bar % 4],
            start: Math.max(0, t + h - (b === 0 && h === 0 ? 0.15 : 0)),
            end: t + h + 0.28,
            velocity: 90,
          })
      }
    const midi = stemsToParsedMidi(
      [
        { id: "other", notes },
        { id: "bass", notes: bass },
      ],
      100
    )
    const roles = guessRoles(midi.parts)
    const song = midiToSong(midi, roles, guessKey(midi, roles))
    expect(song.chords.map((c) => c.degree)).toEqual([0, 5, 3, 4, 0, 5, 3, 4])
    expect(song.chords.every((c) => c.type === "triad")).toBe(true)
  })
})
