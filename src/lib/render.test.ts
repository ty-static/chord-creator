import { describe, expect, it } from "vitest"

import type { NoteEvent } from "@/lib/arrange"
import { DEFAULT_MIX, type Mix } from "@/lib/audio-engine"
import {
  LEAD_IN,
  TAIL,
  audibleTracks,
  encodeWav,
  renderSeconds,
  stemMix,
  trimmedLength,
} from "@/lib/render"

const note = (
  track: NoteEvent["track"],
  start = 0,
  duration = 1
): NoteEvent => ({
  midi: 60,
  start,
  duration,
  velocity: 100,
  track,
})

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.slice(at, at + n))

describe("encodeWav", () => {
  const left = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2])
  const right = Float32Array.from([0.25, 0, 0, 0, 0, 0, 0])
  const wav = encodeWav([left, right], 44100)
  const view = new DataView(wav.buffer)

  it("writes a standard 16-bit PCM stereo header", () => {
    expect(ascii(wav, 0, 4)).toBe("RIFF")
    expect(ascii(wav, 8, 4)).toBe("WAVE")
    expect(ascii(wav, 12, 4)).toBe("fmt ")
    expect(ascii(wav, 36, 4)).toBe("data")
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(28, true)).toBe(44100 * 4)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(left.length * 4)
    expect(wav.length).toBe(44 + left.length * 4)
  })

  it("interleaves channels and clips out-of-range samples", () => {
    const frame = (i: number) => [
      view.getInt16(44 + i * 4, true),
      view.getInt16(46 + i * 4, true),
    ]
    expect(frame(0)).toEqual([0, Math.round(0.25 * 0x7fff)])
    expect(frame(1)[0]).toBe(Math.round(0.5 * 0x7fff))
    expect(frame(2)[0]).toBe(-0x4000)
    expect(frame(3)[0]).toBe(0x7fff)
    expect(frame(4)[0]).toBe(-0x8000)
    expect(frame(5)[0]).toBe(0x7fff) // 2 → clipped
    expect(frame(6)[0]).toBe(-0x8000) // -2 → clipped
  })

  it("handles an empty buffer", () => {
    const empty = encodeWav([new Float32Array(0), new Float32Array(0)], 48000)
    expect(empty.length).toBe(44)
    expect(new DataView(empty.buffer).getUint32(40, true)).toBe(0)
  })
})

describe("trimmedLength", () => {
  it("cuts trailing silence on all channels", () => {
    const a = new Float32Array(100)
    const b = new Float32Array(100)
    a[10] = 0.5
    b[40] = -0.01 // the reverb tail on one side counts
    b[90] = 1e-6 // below the threshold
    expect(trimmedLength([a, b], 0)).toBe(41)
  })

  it("never cuts before the end of the song", () => {
    const a = new Float32Array(100)
    a[5] = 0.5
    expect(trimmedLength([a], 60)).toBe(60)
    expect(trimmedLength([a], 500)).toBe(100)
  })
})

describe("renderSeconds", () => {
  it("covers the song plus a tail for releases and reverb", () => {
    // 8 beats at 120 bpm = 4 s
    expect(renderSeconds([note("chords", 0, 8)], 120, 8)).toBeCloseTo(
      LEAD_IN + 4 + TAIL
    )
  })

  it("stretches to a note that rings past the end", () => {
    expect(renderSeconds([note("melody", 7, 3)], 60, 8)).toBeCloseTo(
      LEAD_IN + 10 + TAIL
    )
  })
})

describe("audibleTracks", () => {
  const events = [note("chords"), note("melody"), note("drums")]

  it("lists tracks with notes", () => {
    expect(audibleTracks(events, DEFAULT_MIX).sort()).toEqual([
      "chords",
      "drums",
      "melody",
    ])
  })

  it("follows mute and solo", () => {
    const mix: Mix = structuredClone(DEFAULT_MIX)
    mix.melody.mute = true
    expect(audibleTracks(events, mix).sort()).toEqual(["chords", "drums"])
    mix.drums.solo = true
    expect(audibleTracks(events, mix)).toEqual(["drums"])
    mix.drums.volume = 0
    expect(audibleTracks(events, mix)).toEqual([])
  })
})

describe("stemMix", () => {
  it("plays one track at its own volume, whatever is soloed", () => {
    const mix: Mix = {
      ...DEFAULT_MIX,
      melody: { volume: 0.4, mute: false, solo: true },
      bass: { volume: 0.6, mute: true, solo: false },
    }
    const bass = stemMix(mix, "bass")
    expect(audibleTracks([note("bass"), note("melody")], bass)).toEqual([
      "bass",
    ])
    expect(bass.bass.volume).toBe(0.6)
    expect(Object.values(bass).some((m) => m.solo)).toBe(false)
  })
})
