import { describe, expect, it } from "vitest"

import {
  ANALYSIS_RATE as SR,
  HOP,
  analyseFrames,
  estimateTempo,
  framesToNotes,
  mono,
  peaks,
  snapNotes,
  toParsedMidi,
  yin,
} from "@/lib/audio-to-midi"
import { buildMidi } from "@/lib/midi"
import { parseMidi } from "@/lib/midi-import"
import { toEvents } from "@/lib/audio-to-midi"

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** A plucked-ish tone with a few harmonics, like a real instrument. */
function tone(midi: number, seconds: number, amp = 0.5) {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const f = freq(midi)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.min(1, t / 0.01) * Math.exp(-t * 1.5)
    out[i] =
      amp *
      env *
      (Math.sin(2 * Math.PI * f * t) +
        0.5 * Math.sin(4 * Math.PI * f * t) +
        0.25 * Math.sin(6 * Math.PI * f * t))
  }
  return out
}
const silence = (seconds: number) => new Float32Array(Math.round(seconds * SR))
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const convert = async (samples: Float32Array) => {
  const frames = await analyseFrames(samples, SR)
  return { frames, notes: framesToNotes(frames, HOP / SR) }
}

describe("audio to MIDI", () => {
  it("hears the pitch of a tone across the range", () => {
    for (const midi of [33, 45, 57, 60, 69, 76, 84]) {
      const p = yin(tone(midi, 0.2), 200, SR)
      expect(p, `note ${midi}`).not.toBeNull()
      expect(Math.abs(p!.midi - midi)).toBeLessThan(0.2)
    }
  })

  it("hears nothing in silence or noise", () => {
    expect(yin(silence(0.2), 0, SR)).toBeNull()
    let seed = 1
    const noise = new Float32Array(2000).map(() => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647 - 0.5
    })
    expect(yin(noise, 0, SR)).toBeNull()
  })

  it("turns a melody into its notes, with their timing", async () => {
    const melody = [60, 62, 64, 65, 67]
    const { notes } = await convert(
      join(...melody.flatMap((m) => [tone(m, 0.4), silence(0.1)]))
    )
    expect(notes.map((n) => n.pitch)).toEqual(melody)
    notes.forEach((n, i) => {
      expect(n.start).toBeCloseTo(i * 0.5, 1)
      expect(n.end - n.start).toBeGreaterThan(0.3)
      expect(n.velocity).toBeGreaterThanOrEqual(1)
      expect(n.velocity).toBeLessThanOrEqual(127)
    })
  })

  it("splits the same note struck twice in a row", async () => {
    const { notes } = await convert(join(tone(64, 0.4), tone(64, 0.4)))
    expect(notes.map((n) => n.pitch)).toEqual([64, 64])
  })

  it("makes louder notes louder", async () => {
    const { notes } = await convert(
      join(tone(60, 0.3, 0.1), silence(0.1), tone(60, 0.3, 0.8))
    )
    expect(notes).toHaveLength(2)
    expect(notes[1].velocity).toBeGreaterThan(notes[0].velocity)
  })

  it("guesses the tempo from evenly spaced notes", async () => {
    for (const bpm of [90, 120, 140]) {
      const beat = 60 / bpm
      const { frames, notes } = await convert(
        join(
          ...Array.from({ length: 12 }, (_, i) =>
            join(tone(60 + (i % 3) * 2, beat * 0.7), silence(beat * 0.3))
          )
        )
      )
      expect(
        Math.abs(estimateTempo(notes, frames, HOP / SR) - bpm)
      ).toBeLessThanOrEqual(2)
    }
  })

  it("makes a MIDI file the importer can read back", async () => {
    const { notes } = await convert(join(tone(67, 0.5), tone(72, 0.5)))
    const parsed = toParsedMidi(notes, 120)
    expect(parsed.parts[0].notes.map((n) => n.pitch)).toEqual([67, 72])
    expect(parsed.length).toBeCloseTo(2, 0)
    const bytes = buildMidi(toEvents(notes, 120), {
      bpm: 120,
      title: "Take",
      keySig: { sf: 0, minor: false },
    })
    const back = parseMidi(bytes.buffer as ArrayBuffer)
    expect(back.bpm).toBe(120)
    expect(back.parts.flatMap((p) => p.notes.map((n) => n.pitch))).toEqual([
      67, 72,
    ])
  })

  it("mixes channels and summarises a waveform", () => {
    const m = mono([new Float32Array([1, 0]), new Float32Array([0, 1])])
    expect(Array.from(m)).toEqual([0.5, 0.5])
    expect(Array.from(peaks(new Float32Array([0, -1, 0.5, 0.25]), 2))).toEqual([
      1, 0.5,
    ])
  })

  it("can be cancelled", async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(
      analyseFrames(tone(60, 30), SR, { signal: ctl.signal })
    ).rejects.toThrow("Cancelled")
  })

  it("lines notes up with the beat", () => {
    const n = (pitch: number, start: number, end: number) => ({
      pitch,
      start,
      end,
      velocity: 90,
    })
    // At 120 BPM a 1/16 step is 0.125 s and a 1/8 step 0.25 s.
    const played = [n(60, 0.04, 0.47), n(62, 0.52, 0.98), n(64, 1.07, 1.1)]
    expect(snapNotes(played, 120, "off")).toBe(played)
    expect(snapNotes(played, 120, "16")).toEqual([
      n(60, 0, 0.5),
      n(62, 0.5, 1),
      // Too short to round to a step: it gets one.
      n(64, 1.125, 1.25),
    ])
    expect(snapNotes(played, 120, "8").map((x) => [x.start, x.end])).toEqual([
      [0, 0.5],
      [0.5, 1],
      [1, 1.25],
    ])
  })

  it("keeps a snapped melody one note at a time", () => {
    const n = (pitch: number, start: number, end: number) => ({
      pitch,
      start,
      end,
      velocity: 90,
    })
    // A grace note and the note after it land on one step: the longer stays.
    // A note held into the next one ends where that one starts.
    const out = snapNotes(
      [n(60, 0, 0.9), n(61, 0.48, 0.52), n(62, 0.51, 1), n(64, 0.95, 1.5)],
      120,
      "8"
    )
    expect(out.map((x) => [x.pitch, x.start, x.end])).toEqual([
      [60, 0, 0.5],
      [62, 0.5, 1],
      [64, 1, 1.5],
    ])
  })
})
