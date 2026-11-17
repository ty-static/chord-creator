import { describe, expect, it } from "vitest"

import { type NoteEvent, type Song, buildEvents, layout } from "@/lib/arrange"
import { EXAMPLES } from "@/lib/examples"
import { buildMidi } from "@/lib/midi"
import {
  MidiParseError,
  guessKey,
  guessRoles,
  midiToSong,
  parseMidi,
} from "@/lib/midi-import"
import {
  type Chord,
  type MelodyNote,
  STEPS_PER_BEAT,
  chordName,
  keyLabel,
  keySignature,
} from "@/lib/music"

const ALL = { chords: true, melody: true, bass: true, drums: true }

/** The whole song as one long loop, the way an import sees it. */
function flatten(song: Song) {
  const chords: Chord[] = []
  const melody: MelodyNote[] = []
  for (const p of layout(song)) {
    chords.push(...p.section.chords)
    for (const n of p.section.melody)
      melody.push({ ...n, start: n.start + p.start * STEPS_PER_BEAT })
  }
  const drums = song.sections.some((x) => x.drums.enabled)
  return { chords, melody, drums }
}

const toBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

/** Variable-length quantity, as MIDI writes delta times. */
function vlq(n: number) {
  const out = [n & 0x7f]
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80)
  return out
}

/** One note-on/off event after `delta` ticks. */
const ev = (delta: number, on: boolean, pitch: number) => [
  ...vlq(delta),
  on ? 0x90 : 0x80,
  pitch,
  on ? 90 : 0,
]

/** A tiny hand-written MIDI file builder, for inputs our exporter never makes. */
function smf(tracks: number[][], ppq = 96, format = 1) {
  const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
  const u32 = (n: number) => [
    (n >>> 24) & 0xff,
    (n >> 16) & 0xff,
    (n >> 8) & 0xff,
    n & 0xff,
  ]
  const bytes = [
    ...[0x4d, 0x54, 0x68, 0x64], // MThd
    ...u32(6),
    ...u16(format),
    ...u16(tracks.length),
    ...u16(ppq),
  ]
  for (const t of tracks) {
    const body = [...t, 0x00, 0xff, 0x2f, 0x00]
    bytes.push(0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body)
  }
  return new Uint8Array(bytes).buffer
}

describe("MIDI export", () => {
  const song = EXAMPLES[0].build()
  const bytes = buildMidi(buildEvents(song, ALL), {
    bpm: song.bpm,
    title: "Test",
    keySig: keySignature(song.key),
  })

  it("writes a format-1 file with a conductor track plus one track per part", () => {
    const ascii = (i: number) => String.fromCharCode(...bytes.slice(i, i + 4))
    expect(ascii(0)).toBe("MThd")
    expect(bytes[9]).toBe(1) // format 1
    expect((bytes[10] << 8) | bytes[11]).toBe(5) // tempo + chords, melody, bass, drums
    expect((bytes[12] << 8) | bytes[13]).toBe(480) // PPQ
  })

  it("puts drums on channel 10", () => {
    const parts = parseMidi(toBuffer(bytes)).parts
    expect(parts.find((p) => p.name === "Drums")?.channel).toBe(9)
    expect(parts.find((p) => p.name === "Drums")?.isDrums).toBe(true)
  })

  it("stores tempo and key signature", () => {
    const midi = parseMidi(toBuffer(bytes))
    expect(midi.bpm).toBe(song.bpm)
    expect(midi.keySig).toEqual(keySignature(song.key))
  })

  it("keeps every note's pitch and timing", () => {
    const events = buildEvents(song, ALL)
    const midi = parseMidi(toBuffer(bytes))
    const byTime = (a: number[], b: number[]) =>
      a[1] - b[1] || a[0] - b[0] || a[2] - b[2]
    const got = midi.parts
      .flatMap((p) => p.notes.map((n) => [n.pitch, n.start, n.end - n.start]))
      .sort(byTime)
    const want = events
      .map((e: NoteEvent) => [e.midi, e.start, e.duration])
      .sort(byTime)
    expect(got).toHaveLength(want.length)
    // Times are stored in ticks (1/480 beat), so allow that much rounding.
    got.forEach(([pitch, start, length], i) => {
      expect(pitch).toBe(want[i][0])
      expect(start).toBeCloseTo(want[i][1], 2)
      expect(Math.abs(length - want[i][2])).toBeLessThanOrEqual(1 / 480)
    })
  })
})

describe("MIDI export of a song with sections", () => {
  const song = EXAMPLES.find((e) => e.id === "pop")!.build()
  const placed = layout(song)
  const bytes = buildMidi(buildEvents(song, ALL), {
    bpm: song.bpm,
    title: "x",
    keySig: keySignature(song.key),
    markers: placed.map((p) => ({ beat: p.start, text: p.section.name })),
  })

  it("writes a marker at the start of every section", () => {
    const markers: [number, string][] = []
    // Walk the conductor track (the first MTrk) for FF 06 events.
    let i = 14 + 8
    let tick = 0
    const end =
      14 +
      8 +
      ((bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21])
    const readVlq = () => {
      let v = 0
      for (;;) {
        const b = bytes[i++]
        v = (v << 7) | (b & 0x7f)
        if (!(b & 0x80)) return v
      }
    }
    while (i < end) {
      tick += readVlq()
      expect(bytes[i++]).toBe(0xff) // only meta events here
      const type = bytes[i++]
      const len = readVlq()
      if (type === 0x06)
        markers.push([
          tick / 480,
          String.fromCharCode(...bytes.slice(i, i + len)),
        ])
      i += len
    }
    expect(markers).toEqual(placed.map((p) => [p.start, p.section.name]))
  })

  it("still imports, as one long section", () => {
    const midi = parseMidi(toBuffer(bytes))
    // The length runs to the last note-off, a hair before the final bar line.
    expect(Math.ceil(midi.length)).toBe(placed.reduce((n, p) => n + p.beats, 0))
  })
})

describe("MIDI import round trip", () => {
  for (const example of EXAMPLES) {
    it(`re-imports “${example.label}”`, () => {
      const song = example.build()
      const bytes = buildMidi(buildEvents(song, ALL), {
        bpm: song.bpm,
        title: "x",
        keySig: keySignature(song.key),
      })
      const midi = parseMidi(toBuffer(bytes))
      const roles = guessRoles(midi.parts)
      const flat = flatten(song)
      expect(Object.values(roles).sort()).toEqual(
        flat.drums
          ? ["bass", "chords", "drums", "melody"]
          : ["bass", "chords", "melody"]
      )
      const key = guessKey(midi, roles)
      const result = midiToSong(midi, roles, key)

      // Same chord names and melody pitches/rhythm, even if the key is
      // spelled as a relative mode (the notes are identical).
      expect(result.chords.map((c) => chordName(c, key))).toEqual(
        flat.chords.map((c) => chordName(c, song.key))
      )
      expect(result.chords.map((c) => c.beats)).toEqual(
        flat.chords.map((c) => c.beats)
      )
      const melodyPitches = (m: MelodyNote[], k: typeof key) =>
        m.map((n) => [
          n.start,
          n.length,
          chordName({ degree: n.degree % 7, type: "triad", inversion: 0 }, k),
        ])
      expect(melodyPitches(result.melody, key)).toEqual(
        melodyPitches(flat.melody, song.key)
      )
      expect(result.snapped).toBe(0)
      expect(result.drums !== null).toBe(flat.drums)
    })
  }

  it("recovers the mode when the song starts and ends on its tonic", () => {
    const rock = EXAMPLES.find((e) => e.id === "rock")!.build()
    const bytes = buildMidi(buildEvents(rock, ALL), {
      bpm: rock.bpm,
      title: "x",
      keySig: keySignature(rock.key),
    })
    const midi = parseMidi(toBuffer(bytes))
    expect(keyLabel(guessKey(midi, guessRoles(midi.parts)))).toBe(
      keyLabel(rock.key)
    )
  })

  it("recovers drum patterns", () => {
    for (const id of ["pop", "lofi", "epic"]) {
      const song = EXAMPLES.find((e) => e.id === id)!.build()
      const bytes = buildMidi(buildEvents(song, ALL), {
        bpm: song.bpm,
        title: "x",
        keySig: keySignature(song.key),
      })
      const midi = parseMidi(toBuffer(bytes))
      const roles = guessRoles(midi.parts)
      const result = midiToSong(midi, roles, guessKey(midi, roles))
      const want = song.sections[0].drums.pattern
      if (song.sections.length === 1)
        expect(result.drums?.pattern).toEqual(want)
      else {
        // Fills in other sections shift what counts as an accent, so for a
        // song with sections compare where the hits are, not how loud.
        const hits = (p: typeof want) =>
          Object.fromEntries(
            Object.entries(p).map(([k, row]) => [k, row.map((v) => v > 0)])
          )
        expect(hits(result.drums!.pattern)).toEqual(hits(want))
      }
    }
  })
})

describe("MIDI import edge cases", () => {
  it("rejects files that aren't MIDI", () => {
    expect(() =>
      parseMidi(new TextEncoder().encode("hello world").buffer)
    ).toThrow(MidiParseError)
  })

  it("rejects files with no notes", () => {
    expect(() =>
      parseMidi(smf([[0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]]))
    ).toThrow(/No notes/)
  })

  it("handles running status and note-on with velocity 0 as note-off", () => {
    // C–E–G as a chord for one beat, written with running status.
    const track = [
      0x00,
      0x90,
      60,
      100, // note on (status byte)
      0x00,
      64,
      100, // running status
      0x00,
      67,
      100,
      0x60,
      60,
      0, // velocity 0 = off, after one beat (96 ticks)
      0x00,
      64,
      0,
      0x00,
      67,
      0,
    ]
    const midi = parseMidi(smf([track]))
    expect(midi.bpm).toBe(120) // default when no tempo event
    expect(midi.parts[0].notes.map((n) => [n.pitch, n.start, n.end])).toEqual([
      [60, 0, 1],
      [64, 0, 1],
      [67, 0, 1],
    ])
  })

  it("closes notes left hanging at the end of a track", () => {
    const midi = parseMidi(
      smf([[0x00, 0x90, 60, 100, 0x81, 0x40, 0xb0, 7, 100]])
    )
    expect(midi.parts[0].notes[0].end).toBeGreaterThan(0)
  })

  it("guesses roles from register and polyphony when tracks have no names", () => {
    const note = ev
    const pad = [
      ...note(0, true, 60),
      ...note(0, true, 64),
      ...note(0, true, 67),
      ...note(96 * 4, false, 60),
      ...note(0, false, 64),
      ...note(0, false, 67),
    ]
    const lead = [
      ...note(0, true, 76),
      ...note(96, false, 76),
      ...note(0, true, 79),
      ...note(96, false, 79),
    ]
    const bass = [...note(0, true, 36), ...note(96 * 4, false, 36)]
    const roles = guessRoles(parseMidi(smf([pad, lead, bass])).parts)
    expect(Object.values(roles)).toEqual(["chords", "melody", "bass"])
  })

  it("splits a bar into two chords when the harmony changes halfway", () => {
    const n = ev
    // C major for two beats, then G major (B–D–G) for two beats.
    const pad = [
      ...n(0, true, 60),
      ...n(0, true, 64),
      ...n(0, true, 67),
      ...n(192, false, 60),
      ...n(0, false, 64),
      ...n(0, false, 67),
      ...n(0, true, 59),
      ...n(0, true, 62),
      ...n(0, true, 67),
      ...n(192, false, 59),
      ...n(0, false, 62),
      ...n(0, false, 67),
    ]
    const midi = parseMidi(smf([pad]))
    const roles = { [midi.parts[0].id]: "chords" as const }
    const result = midiToSong(midi, roles, { root: 0, scale: "major" })
    expect(
      result.chords.map((c) => [
        chordName(c, { root: 0, scale: "major" }),
        c.beats,
      ])
    ).toEqual([
      ["C", 2],
      ["G/B", 2], // B is the lowest note, so it is a first inversion
    ])
  })
})
