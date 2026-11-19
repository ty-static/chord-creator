import { describe, expect, it } from "vitest"

import { joinChunks, takeToFile, trimSilence } from "@/lib/recorder"

const SR = 8000
const tone = (seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(seconds * SR) },
    (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / SR)
  )
/** The header facts of a 16-bit PCM WAV. */
function readWav(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const channels = view.getUint16(22, true)
  return {
    channels,
    sampleRate: view.getUint32(24, true),
    length: view.getUint32(40, true) / 2 / channels,
  }
}
const quiet = (seconds: number) => new Float32Array(Math.round(seconds * SR))

describe("microphone takes", () => {
  it("joins the blocks the microphone hands over", () => {
    const out = joinChunks([
      new Float32Array([1, 2]),
      new Float32Array([]),
      new Float32Array([3]),
    ])
    expect(Array.from(out)).toEqual([1, 2, 3])
  })

  it("cuts the quiet before and after the sound, keeping a little", () => {
    const take = joinChunks([quiet(1.5), tone(1), quiet(2)])
    const cut = trimSilence(take, SR, { keep: 0.1 })
    expect(cut.length / SR).toBeGreaterThan(1.1)
    expect(cut.length / SR).toBeLessThan(1.3)
    // The sound starts about 0.1 s in.
    const first = cut.findIndex((v) => Math.abs(v) > 0.01)
    expect(first / SR).toBeCloseTo(0.1, 1)
  })

  it("keeps soft sounds and leaves silence alone", () => {
    const take = joinChunks([quiet(1), tone(0.5, 0.05), tone(0.5), quiet(1)])
    const cut = trimSilence(take, SR, { keep: 0 })
    expect(cut.length / SR).toBeCloseTo(1, 1)
    const nothing = quiet(1)
    expect(trimSilence(nothing, SR)).toBe(nothing)
  })

  it("saves a take as a WAV file named for when it was made", async () => {
    const file = takeToFile(
      { samples: joinChunks([quiet(1), tone(0.5)]), sampleRate: SR },
      new Date(2026, 10, 19, 9, 5)
    )
    expect(file.name).toBe("Recording 19 Nov 2026.wav")
    expect(file.type).toBe("audio/wav")
    const wav = readWav(new Uint8Array(await file.arrayBuffer()))
    expect(wav.sampleRate).toBe(SR)
    expect(wav.channels).toBe(1)
    // Trimmed: the second of quiet at the start is (mostly) gone.
    expect(wav.length / SR).toBeLessThan(0.7)
  })
})
