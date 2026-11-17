import { describe, expect, it } from "vitest"

import { type Song, buildEvents, kickTimes, layout } from "@/lib/arrange"
import { BASS_STYLES, type BassStyle, bassLine } from "@/lib/bass"
import { DEFAULT_DRUMS, presetPattern } from "@/lib/drums"
import { EXAMPLES } from "@/lib/examples"
import { type Chord, type Key, chordBassMidi } from "@/lib/music"
import { decodeShare, encodeShare, normalizeSong } from "@/lib/song-file"

const C: Key = { root: 0, scale: "major" }
const chord = (degree: number, beats = 4): Chord => ({
  id: String(degree),
  degree,
  type: "triad",
  inversion: 0,
  beats,
})
// C – G – Am – F, a bar each
const POP = [chord(0), chord(4), chord(5), chord(3)]
const pitchClass = (m: number) => ((m % 12) + 12) % 12
const ALL = { chords: true, melody: true, bass: true, drums: true }

describe("bass lines", () => {
  it("roots: one long root per chord, as before", () => {
    const line = bassLine(POP, C, "root")
    expect(line.map((n) => n.midi)).toEqual(POP.map((c) => chordBassMidi(c, C)))
    expect(line.map((n) => n.start)).toEqual([0, 4, 8, 12])
  })

  it("root–fifth alternates on half notes", () => {
    const line = bassLine([chord(0)], C, "fifths")
    expect(line.map((n) => [n.start, pitchClass(n.midi)])).toEqual([
      [0, 0], // C
      [2, 7], // G
    ])
  })

  it("octaves jump an octave on every off-beat", () => {
    const line = bassLine([chord(0, 2)], C, "octaves")
    expect(line).toHaveLength(4)
    expect(line[1].midi - line[0].midi).toBe(12)
    expect(line.map((n) => n.start)).toEqual([0, 0.5, 1, 1.5])
  })

  it("walking: a note a beat, stepping into the next chord", () => {
    const line = bassLine(POP, C, "walking")
    expect(line).toHaveLength(16)
    line.forEach((n, i) => expect(n.start).toBe(i))
    // Bar 1 (C) ends a semitone from the next root (G).
    const nextRoot = line[4].midi
    expect(Math.abs(line[3].midi - nextRoot)).toBe(1)
    // The last chord walks back into the first.
    expect(Math.abs(line[15].midi - (line[0].midi + 0)) % 12).toBeLessThan(2)
    // Chord tones on the beats between.
    expect(pitchClass(line[1].midi)).toBe(4) // E, the third of C
    expect(pitchClass(line[2].midi)).toBe(7) // G, the fifth
  })

  it("walking over a repeated chord approaches from the fifth", () => {
    const line = bassLine([chord(0), chord(0)], C, "walking")
    expect(pitchClass(line[3].midi)).toBe(7)
  })

  it("syncopated: pushed eighths, cut to the chord's length", () => {
    const bar = bassLine([chord(0)], C, "pop")
    expect(bar.map((n) => n.start)).toEqual([0, 1.5, 2.5, 3, 3.5])
    const short = bassLine([chord(0, 2)], C, "pop")
    expect(short.map((n) => n.start)).toEqual([0, 1.5])
    for (const n of short) expect(n.start + n.duration).toBeLessThanOrEqual(2)
  })

  it("follow the kick: the root on every kick", () => {
    const line = bassLine([chord(0), chord(4)], C, "kick", [0, 1.5, 2, 4, 6.5])
    expect(line.map((n) => n.start)).toEqual([0, 1.5, 2, 4, 6.5])
    expect(pitchClass(line[3].midi)).toBe(7) // G chord
    // Notes end before the next kick.
    expect(line[0].start + line[0].duration).toBeLessThanOrEqual(1.5)
    // No kicks in a chord: one long root.
    expect(bassLine([chord(0)], C, "kick", [])).toHaveLength(1)
    // First kick after the chord change: hold the root until it.
    expect(bassLine([chord(0)], C, "kick", [1]).map((n) => n.start)).toEqual([
      0, 1,
    ])
  })

  it("reads kick times from the drum pattern", () => {
    const drums = {
      ...DEFAULT_DRUMS,
      enabled: true,
      pattern: presetPattern("rock"),
    }
    const kicks = kickTimes(drums, 8)
    expect(kicks.length).toBeGreaterThan(0)
    expect(kicks[0]).toBe(0)
    expect(kicks.some((k) => k >= 4)).toBe(true) // repeats each bar
    expect(kickTimes({ ...drums, enabled: false }, 8)).toEqual([])
  })

  it("every style stays in a playable bass range for every example", () => {
    for (const ex of EXAMPLES)
      for (const { value } of BASS_STYLES) {
        const song = ex.build()
        for (const s of song.sections) {
          const line = bassLine(s.chords, song.key, value, [0, 1, 2, 3])
          const end = s.chords.reduce((n, c) => n + c.beats, 0)
          for (const n of line) {
            expect(n.midi).toBeGreaterThanOrEqual(23)
            expect(n.midi).toBeLessThanOrEqual(64)
            expect(n.start).toBeGreaterThanOrEqual(0)
            expect(n.start + n.duration).toBeLessThanOrEqual(end + 1e-9)
            expect(n.duration).toBeGreaterThan(0)
          }
        }
      }
  })
})

describe("bass style in songs", () => {
  const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()
  const bassOf = (song: Song, slot: number) => {
    const p = layout(song)[slot]
    return buildEvents(song, ALL).filter(
      (e) =>
        e.track === "bass" && e.start >= p.start && e.start < p.start + p.beats
    )
  }

  it("uses the song's style, unless a section has its own", () => {
    const base = pop()
    const song: Song = {
      ...base,
      bassStyle: "octaves",
      sections: base.sections.map((s, i) =>
        i === 0 ? { ...s, bassStyle: "root" as BassStyle } : s
      ),
    }
    const placed = layout(song)
    const a = placed.findIndex((p) => p.section === song.sections[0])
    const b = placed.findIndex((p) => p.section !== song.sections[0])
    expect(bassOf(song, a)).toHaveLength(song.sections[0].chords.length)
    expect(bassOf(song, b).length).toBe(placed[b].beats * 2)
  })

  it("is saved in files and links, and checked", async () => {
    const base = pop()
    const song: Song = {
      ...base,
      bassStyle: "walking",
      sections: base.sections.map((s, i) =>
        i === 1 ? { ...s, bassStyle: "kick" as BassStyle } : s
      ),
    }
    const back = await decodeShare(await encodeShare(song))
    expect(back.bassStyle).toBe("walking")
    expect(back.sections[1].bassStyle).toBe("kick")
    const odd = normalizeSong({ ...song, bassStyle: "tuba" })
    expect(odd.bassStyle).toBeUndefined()
    expect("bassStyle" in normalizeSong({ ...song, bassStyle: "root" })).toBe(
      false
    )
  })
})
