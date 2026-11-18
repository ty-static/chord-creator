import { describe, expect, it } from "vitest"

import { type Song, partEvents } from "@/lib/arrange"
import { bassLine } from "@/lib/bass"
import {
  DEFAULT_DRUMS,
  drumHits,
  drumPresets,
  fitPattern,
  matchingPreset,
  presetPattern,
} from "@/lib/drums"
import { EXAMPLES } from "@/lib/examples"
import {
  METERS,
  barBeats,
  barSteps,
  beatsIn,
  drumSteps,
  lengthLabel,
  meterFromTimeSig,
  meterOf,
  midiTimeSig,
  pulses,
} from "@/lib/meter"
import { buildMidi } from "@/lib/midi"
import { type Chord, type MelodyNote, clearBar, uid } from "@/lib/music"
import { setMeter } from "@/lib/sections"
import { normalizeSong } from "@/lib/song-file"

const chord = (degree: number, beats: number): Chord => ({
  id: uid(),
  degree,
  type: "triad",
  inversion: 0,
  beats,
})
const C = { root: 0, scale: "major" as const }
const ALL = { chords: true, melody: true, bass: true, drums: true }

describe("meters", () => {
  it("know their bar lengths", () => {
    const sizes = Object.fromEntries(
      METERS.map((m) => [m.id, [barBeats(m), barSteps(m), drumSteps(m)]])
    )
    expect(sizes).toEqual({
      "4/4": [4, 8, 16],
      "3/4": [3, 6, 12],
      "2/4": [2, 4, 8],
      "5/4": [5, 10, 20],
      "6/8": [3, 6, 12],
      "7/8": [3.5, 7, 14],
      "12/8": [6, 12, 24],
    })
  })

  it("place the felt beats", () => {
    expect(pulses(meterOf("4/4"))).toEqual([0, 1, 2, 3])
    expect(pulses(meterOf("6/8"))).toEqual([0, 1.5])
    expect(pulses(meterOf("7/8"))).toEqual([0, 1, 2])
    // Across bars, and from a chord that starts off the beat.
    expect(beatsIn(meterOf("6/8"), 0, 6)).toEqual([0, 1.5, 3, 4.5])
    expect(beatsIn(meterOf("3/4"), 2.5, 5)).toEqual([2.5, 3, 4])
  })

  it("label chord lengths in bars", () => {
    const six = meterOf("6/8")
    expect(lengthLabel(3, six)).toBe("1 bar")
    expect(lengthLabel(1.5, six)).toBe("½ bar")
    expect(lengthLabel(6, six)).toBe("2 bars")
    expect(lengthLabel(1, meterOf("7/8"))).toBe("1 beat")
  })

  it("map to and from MIDI time signatures", () => {
    expect(midiTimeSig(meterOf("4/4"))).toEqual([4, 2, 24, 8])
    expect(midiTimeSig(meterOf("6/8"))).toEqual([6, 3, 36, 8])
    expect(midiTimeSig(meterOf("7/8"))).toEqual([7, 3, 24, 8])
    expect(meterFromTimeSig([12, 8])).toBe("12/8")
    expect(meterFromTimeSig([9, 8])).toBeNull()
  })
})

describe("drums in other time signatures", () => {
  it("has presets one bar long for every meter", () => {
    for (const m of METERS)
      for (const p of drumPresets(m))
        for (const row of Object.values(p.pattern))
          expect(row, `${m.id} ${p.id}`).toHaveLength(drumSteps(m))
  })

  it("fits a 4/4 groove to 3/4, keeping the downbeat and the backbeat", () => {
    const pop = presetPattern("pop")
    const waltz = fitPattern(pop, 12)
    expect(waltz.kick[0]).toBe(2)
    // The last beat of the bar is the old beat 4: a snare.
    expect(waltz.snare[8]).toBe(pop.snare[12])
    expect(matchingPreset(waltz, "3/4")).toBe("pop")
  })

  it("repeats a 6/8 pattern every three beats", () => {
    const settings = {
      ...DEFAULT_DRUMS,
      enabled: true,
      pattern: presetPattern("pop", "6/8"),
    }
    const kicks = drumHits(settings, 6)
      .filter((h) => h.midi === 36)
      .map((h) => h.start)
    expect(kicks).toEqual([0, 2, 3, 5])
  })
})

describe("playing in other time signatures", () => {
  const part = (meter: Song["meter"], chords: Chord[]) => ({
    key: C,
    chordStyle: "pulse" as const,
    bass: true,
    bassStyle: "fifths" as const,
    voiceLeading: false,
    meter,
    chords,
    melody: [] as MelodyNote[],
    drums: { ...DEFAULT_DRUMS, enabled: false },
  })

  it("pulses chords on dotted quarters in 6/8", () => {
    const events = partEvents(part("6/8", [chord(0, 3), chord(4, 3)]), ALL)
    const starts = [
      ...new Set(
        events.filter((e) => e.track === "chords").map((e) => e.start)
      ),
    ]
    expect(starts).toEqual([0, 1.5, 3, 4.5])
  })

  it("keeps 4/4 pulses on every beat", () => {
    const events = partEvents(part(undefined, [chord(0, 4)]), ALL)
    const starts = [
      ...new Set(
        events.filter((e) => e.track === "chords").map((e) => e.start)
      ),
    ]
    expect(starts).toEqual([0, 1, 2, 3])
  })

  it("plays root–fifth bass on the strong beats of the bar", () => {
    const at = (meter: Song["meter"], beats: number) =>
      bassLine([chord(0, beats)], C, "fifths", [], meterOf(meter)).map(
        (n) => n.start
      )
    expect(at("4/4", 4)).toEqual([0, 2])
    expect(at("3/4", 6)).toEqual([0, 3])
    expect(at("5/4", 5)).toEqual([0, 3])
    expect(at("6/8", 3)).toEqual([0, 1.5])
  })

  it("works the melody bar tools on the meter's bars", () => {
    const melody: MelodyNote[] = [0, 3, 6, 9].map((start) => ({
      id: uid(),
      start,
      length: 2,
      degree: 7,
    }))
    const chords = [chord(0, 3), chord(4, 3)]
    // Bar 2 of 6/8 is steps 6–11.
    expect(clearBar(melody, chords, 1, 6).map((n) => n.start)).toEqual([0, 3])
  })
})

describe("setMeter", () => {
  const song = () => EXAMPLES.find((e) => e.id === "pop")!.build()

  it("fits bars to the new time signature", () => {
    const four = song()
    const six = setMeter(four, "6/8")
    expect(six.meter).toBe("6/8")
    for (const [i, s] of six.sections.entries()) {
      const was = four.sections[i]
      expect(s.chords.map((c) => c.beats)).toEqual(
        was.chords.map((c) => (c.beats * 3) / 4)
      )
      // A note on the downbeat of bar 2 stays on it.
      const onBar2 = was.melody.find((n) => n.start === 8)
      if (onBar2) expect(s.melody.some((n) => n.start === 6)).toBe(true)
      // Notes never overlap or run past the end.
      const end = s.chords.reduce((n, c) => n + c.beats, 0) * 2
      s.melody.forEach((n, j) => {
        expect(n.start + n.length).toBeLessThanOrEqual(end)
        const next = s.melody[j + 1]
        if (next) expect(n.start + n.length).toBeLessThanOrEqual(next.start)
      })
      // The pop groove becomes the 6/8 pop groove.
      if (was.drums.enabled)
        expect(matchingPreset(s.drums.pattern, "6/8")).toBe(
          matchingPreset(was.drums.pattern)
        )
    }
  })

  it("goes back to 4/4 without a meter field", () => {
    const back = setMeter(setMeter(song(), "3/4"), "4/4")
    expect(back.meter).toBeUndefined()
    expect(back.sections[0].chords.map((c) => c.beats)).toEqual(
      song().sections[0].chords.map((c) => c.beats)
    )
  })

  it("survives a save and load", () => {
    const six = setMeter(song(), "6/8")
    const loaded = normalizeSong(JSON.parse(JSON.stringify(six)))
    expect(loaded.meter).toBe("6/8")
    expect(loaded.sections[0].drums.pattern.kick).toHaveLength(12)
    expect(loaded.sections[0].chords).toEqual(six.sections[0].chords)
    // Half-beat lengths are kept; an unknown meter falls back to 4/4.
    expect(
      normalizeSong({ ...six, meter: "9/8" }).sections[0].drums.pattern.kick
    ).toHaveLength(16)
  })
})

describe("MIDI export", () => {
  it("writes the time signature", () => {
    const bytes = buildMidi([], {
      bpm: 90,
      title: "x",
      keySig: { sf: 0, minor: false },
      timeSig: midiTimeSig(meterOf("6/8")),
    })
    const at = bytes.findIndex(
      (b, i) => b === 0xff && bytes[i + 1] === 0x58 && bytes[i + 2] === 4
    )
    expect([...bytes.slice(at + 3, at + 7)]).toEqual([6, 3, 36, 8])
  })
})
