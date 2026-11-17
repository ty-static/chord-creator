// Render the song to audio with the same instruments, mix and reverb as playback,
// faster than real time, in an OfflineAudioContext.

import type { NoteEvent, TrackName } from "@/lib/arrange"
import { AudioEngine, type Mix, trackGains } from "@/lib/audio-engine"
import type { TrackInstruments } from "@/lib/instruments"

export const SAMPLE_RATE = 44100
/** Room after the last note for releases and the reverb to ring out (seconds). */
export const TAIL = 4
/** Silence kept before the first note, so players don't clip the attack (seconds). */
export const LEAD_IN = 0.05
/** Below this a sample counts as silence when trimming the tail (about -72 dB). */
export const SILENCE = 2.5e-4

export interface RenderOptions {
  events: NoteEvent[]
  bpm: number
  /** End of the song in beats. */
  end: number
  instruments: TrackInstruments
  mix: Mix
  reverb: number
  sampleRate?: number
  /** Called with "loading", then "rendering" and a 0..1 fraction. */
  onProgress?: (stage: "loading" | "rendering", fraction: number) => void
}

export interface RenderResult {
  channels: Float32Array[]
  sampleRate: number
  /** Instruments that couldn't load and were rendered with the built-in synth. */
  fallbacks: string[]
}

/** Tracks that have notes and can be heard with this mix. */
export function audibleTracks(events: NoteEvent[], mix: Mix): TrackName[] {
  const gains = trackGains(mix)
  return [...new Set(events.map((e) => e.track))].filter((t) => gains[t] > 0)
}

/** Length of the render in seconds: the song (or the last note, if later) plus the tail. */
export function renderSeconds(events: NoteEvent[], bpm: number, end: number) {
  const lastBeat = Math.max(end, ...events.map((e) => e.start + e.duration))
  return LEAD_IN + (lastBeat * 60) / bpm + TAIL
}

/** Number of samples to keep: up to the last audible sample, plus a short fade room. */
export function trimmedLength(
  channels: Float32Array[],
  minLength: number,
  threshold = SILENCE
) {
  let last = 0
  for (const ch of channels)
    for (let i = ch.length - 1; i > last; i--)
      if (Math.abs(ch[i]) > threshold) {
        last = i
        break
      }
  const length = channels[0]?.length ?? 0
  return Math.min(length, Math.max(minLength, last + 1))
}

/** Encode interleaved 16-bit PCM WAV. Samples outside -1..1 are clipped. */
export function encodeWav(channels: Float32Array[], sampleRate: number) {
  const n = channels.length
  const length = channels[0]?.length ?? 0
  const dataSize = length * n * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, n, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * n * 2, true) // bytes per second
  view.setUint16(32, n * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  text(36, "data")
  view.setUint32(40, dataSize, true)
  let at = 44
  for (let i = 0; i < length; i++)
    for (let c = 0; c < n; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(at, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true)
      at += 2
    }
  return new Uint8Array(buf)
}

/** Render the song to stereo audio. */
export async function renderSong(opts: RenderOptions): Promise<RenderResult> {
  const sampleRate = opts.sampleRate ?? SAMPLE_RATE
  const seconds = renderSeconds(opts.events, opts.bpm, opts.end)
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(seconds * sampleRate),
    sampleRate
  )
  const engine = new AudioEngine({
    createContext: () => ctx,
    immediate: true,
    mix: opts.mix,
    reverb: opts.reverb,
  })

  opts.onProgress?.("loading", 0)
  const tracks = audibleTracks(opts.events, opts.mix)
  const voices = Object.fromEntries(
    await Promise.all(
      tracks.map(
        async (t) => [t, await engine.voice(opts.instruments[t], t)] as const
      )
    )
  )
  await engine.reverbReady()

  const spb = 60 / opts.bpm
  for (const e of opts.events) {
    const voice = voices[e.track]
    if (!voice) continue
    voice.start({
      note: e.midi,
      time: LEAD_IN + e.start * spb,
      duration: e.duration * spb,
      velocity: e.velocity,
    })
  }

  // Pause the render every so often to report progress.
  const steps = 20
  for (let i = 1; i < steps; i++) {
    const at = (seconds * i) / steps
    void ctx
      .suspend(Math.floor((at * sampleRate) / 128) * (128 / sampleRate))
      .then(() => {
        opts.onProgress?.("rendering", i / steps)
        void ctx.resume()
      })
  }
  opts.onProgress?.("rendering", 0)
  const buffer = await ctx.startRendering()
  opts.onProgress?.("rendering", 1)

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c)
  )
  const songEnd = Math.ceil((LEAD_IN + opts.end * spb) * sampleRate)
  const keep = trimmedLength(channels, songEnd) + Math.round(0.05 * sampleRate)
  return {
    channels: channels.map((ch) => ch.slice(0, Math.min(keep, ch.length))),
    sampleRate,
    fallbacks: engine.status.failed,
  }
}
