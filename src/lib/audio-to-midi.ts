// Turning a recording of one melody (singing, humming, one instrument) into
// MIDI notes, all on this device. Brought over from SoundCheck: pitch per
// short frame, frames joined into notes, and a tempo guess from the onsets.

import type { NoteEvent } from "@/lib/arrange"
import type { ParsedMidi, RawNote } from "@/lib/midi-import"
import { clampBpm } from "@/lib/tempo"

/** Audio is analysed at this rate: plenty for a melody, and quick. */
export const ANALYSIS_RATE = 11025
/** Samples per pitch frame (46 ms) and between frames (11.6 ms). */
export const FRAME = 512
export const HOP = 128
/** Lowest and highest pitch looked for: A1 to C7. */
const MIN_FREQ = 55
const MAX_FREQ = 2093
/** Largest file accepted, and the longest recording. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_SECONDS = 10 * 60

export interface Pitch {
  /** Fractional MIDI note number. */
  midi: number
  /** 0..1: how sure the detector is. */
  clarity: number
}

/**
 * The pitch of one frame by YIN (de Cheveigné & Kawahara): the lag at which
 * the signal best matches a shifted copy of itself. `threshold` is how close
 * that match must be (lower is stricter).
 */
export function yin(
  x: Float32Array,
  offset: number,
  sampleRate: number,
  threshold = 0.15
): Pitch | null {
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ))
  const maxLag = Math.ceil(sampleRate / MIN_FREQ)
  const W = Math.min(FRAME, x.length - offset - maxLag)
  if (W < maxLag) return null
  const d = new Float32Array(maxLag + 2)
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0
    for (let j = 0; j < W; j++) {
      const v = x[offset + j] - x[offset + j + tau]
      s += v * v
    }
    d[tau] = s
  }
  // Cumulative mean normalised difference.
  const c = new Float32Array(maxLag + 2)
  c[0] = 1
  let sum = 0
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    sum += d[tau]
    c[tau] = sum > 0 ? (d[tau] * tau) / sum : 1
  }
  let tau = -1
  for (let t = minLag; t <= maxLag; t++)
    if (c[t] < threshold) {
      while (t + 1 <= maxLag && c[t + 1] < c[t]) t++
      tau = t
      break
    }
  if (tau < 0) return null
  // Between samples: the vertex of a parabola through the three points.
  const a = c[tau - 1],
    b = c[tau],
    e = c[tau + 1]
  const den = a - 2 * b + e
  const shift = den > 0 ? Math.max(-0.5, Math.min(0.5, (a - e) / (2 * den))) : 0
  const freq = sampleRate / (tau + shift)
  if (freq < MIN_FREQ * 0.97 || freq > MAX_FREQ * 1.03) return null
  return { midi: 69 + 12 * Math.log2(freq / 440), clarity: 1 - b }
}

export interface Frame {
  pitch: Pitch | null
  /** Loudness of the frame (root mean square). */
  rms: number
}

export interface AnalyseOptions {
  /** 0..1: higher finds quieter and less certain notes. */
  sensitivity?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

const pause = () => new Promise((r) => setTimeout(r, 0))

/** Pitch and loudness of every frame, yielding now and then to the page. */
export async function analyseFrames(
  samples: Float32Array,
  sampleRate: number,
  { sensitivity = 0.5, onProgress, signal }: AnalyseOptions = {}
): Promise<Frame[]> {
  const threshold = 0.08 + 0.22 * sensitivity
  // Quieter than this (relative to the loudest frame) is silence.
  const gate = 0.06 - 0.05 * sensitivity
  const count = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1)
  const rms = new Float32Array(count)
  let loudest = 0
  for (let i = 0; i < count; i++) {
    let s = 0
    for (let j = 0; j < FRAME; j++) s += samples[i * HOP + j] ** 2
    rms[i] = Math.sqrt(s / FRAME)
    loudest = Math.max(loudest, rms[i])
  }
  const frames: Frame[] = []
  let last = performance.now()
  for (let i = 0; i < count; i++) {
    const loud = loudest > 0 && rms[i] >= loudest * gate
    frames.push({
      pitch: loud ? yin(samples, i * HOP, sampleRate, threshold) : null,
      rms: rms[i],
    })
    if (performance.now() - last > 30) {
      onProgress?.(i / count)
      await pause()
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError")
      last = performance.now()
    }
  }
  onProgress?.(1)
  return frames
}

/** A note found in the recording, in seconds. */
export interface FoundNote {
  pitch: number
  start: number
  end: number
  /** 1..127 */
  velocity: number
}

/** Shortest note kept (seconds); shorter blips are usually noise. */
export const MIN_NOTE = 0.06

/**
 * Joins frames into notes: smooths out single-frame jumps, holds a note while
 * the pitch stays within a semitone of it, and starts a new one when the
 * pitch moves on, the sound stops, or the same note is struck again.
 */
export function framesToNotes(
  frames: Frame[],
  hopSeconds: number
): FoundNote[] {
  // Median of five, so one odd frame (often an octave slip) doesn't split a note.
  const smooth = frames.map((_, i) => {
    const near: number[] = []
    for (let k = i - 2; k <= i + 2; k++) {
      const p = frames[k]?.pitch
      if (p) near.push(p.midi)
    }
    if (!frames[i].pitch || near.length < 3) return null
    near.sort((a, b) => a - b)
    return near[near.length >> 1]
  })

  const raw: (FoundNote & { peak: number })[] = []
  let cur: { pitch: number; from: number; peak: number } | null = null
  const close = (to: number) => {
    if (cur && (to - cur.from) * hopSeconds >= MIN_NOTE)
      raw.push({
        pitch: cur.pitch,
        start: cur.from * hopSeconds,
        end: to * hopSeconds,
        velocity: 0,
        peak: cur.peak,
      })
    cur = null
  }
  for (let i = 0; i < frames.length; i++) {
    const m = smooth[i]
    const { rms } = frames[i]
    if (m === null) {
      close(i)
      continue
    }
    // Struck again: loudness jumps well above where it just was.
    // (A frame spans four hops, so compare with a little while back, within
    // the note.)
    const from = cur ? Math.max(cur.from + 4, i - 8) : i
    const before = Math.min(
      ...frames.slice(from, Math.max(from, i - 3)).map((f) => f.rms),
      Infinity
    )
    const restruck = cur !== null && rms > before * 1.5 && rms > cur.peak * 0.5
    if (cur && (Math.abs(m - cur.pitch) > 0.7 || restruck)) close(i)
    if (!cur) cur = { pitch: Math.round(m), from: i, peak: rms }
    else cur.peak = Math.max(cur.peak, rms)
  }
  close(frames.length)

  const loudest = Math.max(0, ...raw.map((n) => n.peak))
  return raw
    .filter((n) => n.pitch >= 21 && n.pitch <= 108)
    .map(({ peak, ...n }) => ({
      ...n,
      velocity: Math.round(
        40 + 87 * Math.sqrt(loudest > 0 ? peak / loudest : 1)
      ),
    }))
}

/**
 * The tempo, from how the note onsets repeat: the beat length (60–180 BPM)
 * at which the onset pattern best lines up with itself, favouring tempos
 * near 110. Falls back to 120 when there's too little to go on.
 */
export function estimateTempo(
  notes: FoundNote[],
  frames: Frame[],
  hopSeconds: number
) {
  if (notes.length < 4) return 120
  // Onset strength: each note's start, weighted by loudness, plus rises in level.
  const env = new Float32Array(frames.length)
  for (let i = 1; i < frames.length; i++)
    env[i] = Math.max(0, frames[i].rms - frames[i - 1].rms)
  for (const n of notes) {
    const i = Math.round(n.start / hopSeconds)
    if (i < env.length) env[i] += n.velocity / 127
  }
  let best = 120
  let bestScore = -Infinity
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = 60 / bpm / hopSeconds
    let s = 0
    // The beat and its double both count.
    for (const mult of [1, 2]) {
      const l = lag * mult
      const lo = Math.floor(l)
      const f = l - lo
      for (let i = 0; i + lo + 1 < env.length; i++)
        s += (env[i] * (env[i + lo] * (1 - f) + env[i + lo + 1] * f)) / mult
    }
    s *= Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.6) ** 2)
    if (s > bestScore) {
      bestScore = s
      best = bpm
    }
  }
  return clampBpm(Math.round(best))
}

/** Notes in beats at a tempo, as the MIDI importer expects them. */
export function toParsedMidi(notes: FoundNote[], bpm: number): ParsedMidi {
  const beat = (s: number) => (s * bpm) / 60
  const raw: RawNote[] = notes.map((n) => ({
    pitch: n.pitch,
    start: beat(n.start),
    end: beat(n.end),
    velocity: n.velocity,
  }))
  return {
    bpm,
    keySig: null,
    timeSig: [4, 4],
    parts: [
      {
        id: "audio",
        name: "Melody (from audio)",
        channel: 0,
        program: null,
        notes: raw,
        isDrums: false,
      },
    ],
    length: Math.max(0, ...raw.map((n) => n.end)),
  }
}

/** The notes as melody events, for the MIDI writer and for playback. */
export function toEvents(notes: FoundNote[], bpm: number): NoteEvent[] {
  return notes.map((n) => ({
    midi: n.pitch,
    start: (n.start * bpm) / 60,
    duration: ((n.end - n.start) * bpm) / 60,
    velocity: n.velocity,
    track: "melody" as const,
  }))
}

/** Mixes a decoded file down to one channel. */
export function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const ch of channels)
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length
  return out
}

/** Decodes an audio file at the analysis rate (the browser resamples it). */
export async function decodeAudio(file: Blob) {
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE)
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i)
  )
  return {
    samples: mono(channels),
    sampleRate: buffer.sampleRate,
    duration: buffer.duration,
  }
}

/** Loudness envelope for drawing a waveform: the peak of each of `width` slices. */
export function peaks(samples: Float32Array, width: number) {
  const out = new Float32Array(width)
  const step = samples.length / width
  for (let x = 0; x < width; x++) {
    let m = 0
    const end = Math.min(samples.length, Math.floor((x + 1) * step))
    for (let i = Math.floor(x * step); i < end; i++)
      m = Math.max(m, Math.abs(samples[i]))
    out[x] = m
  }
  return out
}

/** How finely notes are lined up with the beat. */
export type Snap = "off" | "8" | "16"

export const SNAPS: { value: Snap; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Notes stay where they were played" },
  {
    value: "8",
    label: "1/8 notes",
    hint: "Notes start on the nearest half beat",
  },
  {
    value: "16",
    label: "1/16 notes",
    hint: "Notes start on the nearest quarter of a beat",
  },
]

/**
 * Notes lined up with the beat at a tempo (beat 1 at 0 s): each start and
 * end moves to the nearest step of the grid, every note lasts at least one
 * step, and as a melody is one note at a time, notes that land on the same
 * step become one (the longer) and a note ends where the next one starts.
 */
export function snapNotes(
  notes: FoundNote[],
  bpm: number,
  snap: Snap
): FoundNote[] {
  if (snap === "off" || !notes.length) return notes
  const step = 60 / bpm / (snap === "8" ? 2 : 4)
  const at = (s: number) => Math.max(0, Math.round(s / step))
  const snapped: {
    pitch: number
    from: number
    to: number
    velocity: number
  }[] = []
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const from = at(n.start)
    const to = Math.max(from + 1, at(n.end))
    const last = snapped[snapped.length - 1]
    if (last && last.from === from) {
      // Two notes on one step: keep the longer.
      if (to - from > last.to - last.from)
        snapped[snapped.length - 1] = { ...n, from, to }
      continue
    }
    if (last && last.to > from) last.to = from
    snapped.push({ pitch: n.pitch, from, to, velocity: n.velocity })
  }
  return snapped.map((n) => ({
    pitch: n.pitch,
    start: n.from * step,
    end: n.to * step,
    velocity: n.velocity,
  }))
}
