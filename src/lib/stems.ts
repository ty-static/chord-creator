// Song to MIDI: a whole mix split into instruments (vocals, bass, drums and
// everything else) by a source-separation model, then each one turned into
// notes. The heavy work happens in stems.worker.ts; this file holds what the
// page needs and the parts that can be tested on their own.

import type { NoteEvent, TrackName } from "@/lib/arrange"
import { type FoundNote, type Snap, snapNotes } from "@/lib/audio-to-midi"
import type { ParsedMidi, RawNote } from "@/lib/midi-import"
import { tempoFromEnvelope } from "@/lib/tempo"

export type StemId = "vocals" | "bass" | "other" | "drums"

export interface StemInfo {
  id: StemId
  label: string
  /** The part of a song it becomes. */
  track: TrackName
  /** Named so the MIDI importer guesses its role. */
  partName: string
}

export const STEMS: StemInfo[] = [
  { id: "vocals", label: "Vocals", track: "melody", partName: "Vocals" },
  {
    id: "other",
    label: "Guitars & keys",
    track: "chords",
    partName: "Guitars & keys",
  },
  { id: "bass", label: "Bass", track: "bass", partName: "Bass" },
  { id: "drums", label: "Drums", track: "drums", partName: "Drums" },
]

/** Stems come back at this rate, mono: enough for finding notes. */
export const STEM_RATE = 22050

/** The separation model: downloaded once, then kept on this device. */
export const MODEL_URL =
  "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx"
export const MODEL_MB = 172
/** The browser cache the model is kept in. */
export const MODEL_CACHE = "chord-creator-models"

export const KICK = 36
export const SNARE = 38
export const HAT = 42

export interface Stem {
  id: StemId
  /** Mono audio at STEM_RATE. */
  audio: Float32Array
  /** Notes (or drum hits) in seconds. */
  notes: FoundNote[]
}

export type StemsProgress =
  | { step: "download"; loaded: number; total: number }
  | { step: "split"; progress: number }
  | { step: "notes"; stem: StemId; progress: number }

/** Messages from the worker. */
export type WorkerOut =
  | { type: "progress"; progress: StemsProgress }
  | { type: "backend"; gpu: boolean }
  | { type: "done"; stems: Stem[] }
  | { type: "error"; message: string }

/** The message that starts the worker. */
export interface WorkerIn {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

// ---------------------------------------------------------------------------
// Drums: onsets in three bands, as kick, snare and closed hi-hat hits.

/** A two-pole filter (RBJ biquad), run over the samples. */
function biquad(
  x: Float32Array,
  sr: number,
  type: "low" | "high" | "band",
  freq: number,
  q = Math.SQRT1_2
) {
  const w = (2 * Math.PI * freq) / sr
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  let b0: number, b1: number, b2: number
  if (type === "low") {
    b0 = (1 - cos) / 2
    b1 = 1 - cos
    b2 = b0
  } else if (type === "high") {
    b0 = (1 + cos) / 2
    b1 = -(1 + cos)
    b2 = b0
  } else {
    b0 = alpha
    b1 = 0
    b2 = -alpha
  }
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  const out = new Float32Array(x.length)
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

/** Hop between analysis frames (samples at STEM_RATE): about 6 ms. */
const DRUM_HOP = 128

/**
 * A band's loudness (RMS) a hop at a time, and its rises (onset strength,
 * on a log scale so quiet hits count too).
 */
function onsetStrength(x: Float32Array) {
  const n = Math.floor(x.length / DRUM_HOP)
  const rms = new Float32Array(n)
  const level = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let e = 0
    for (let i = f * DRUM_HOP; i < (f + 1) * DRUM_HOP; i++) e += x[i] * x[i]
    rms[f] = Math.sqrt(e / DRUM_HOP)
    level[f] = Math.log1p(1000 * rms[f])
  }
  const rise = new Float32Array(n)
  // Against the level a few frames back, so slow attacks still count.
  // (Before the start counts as silence.)
  for (let f = 0; f < n; f++)
    rise[f] = Math.max(
      0,
      level[f] - Math.min(level[f - 1] ?? 0, level[f - 3] ?? 0)
    )
  return { rise, rms }
}

/**
 * Peaks of an onset curve: local maxima well above the curve around them,
 * at least `gap` seconds apart. Returns frame indexes and their strengths.
 */
function pickPeaks(
  { rise, rms }: { rise: Float32Array; rms: Float32Array },
  sr: number,
  gap: number
) {
  const hop = DRUM_HOP / sr
  // A hit must also be loud in its band (just after it starts), compared
  // with the band's loudest: another drum's spill rises but stays quiet.
  let peakRms = 0
  for (const v of rms) peakRms = Math.max(peakRms, v)
  const after = Math.round(0.03 / hop)
  const loudEnough = (f: number) => {
    let m = 0
    for (let g = f; g <= Math.min(rms.length - 1, f + after); g++)
      m = Math.max(m, rms[g])
    return m >= peakRms * 0.25
  }
  const around = Math.round(0.4 / hop)
  const near = Math.max(1, Math.round(0.03 / hop))
  const minGap = Math.round(gap / hop)
  let loudest = 0
  for (const v of rise) loudest = Math.max(loudest, v)
  const out: { frame: number; strength: number }[] = []
  if (loudest === 0) return out
  // A running mean for the local threshold.
  const sum = new Float64Array(rise.length + 1)
  for (let i = 0; i < rise.length; i++) sum[i + 1] = sum[i] + rise[i]
  for (let f = 0; f < rise.length - 1; f++) {
    const v = rise[f]
    if (v < loudest * 0.15) continue
    const lo = Math.max(0, f - around)
    const hi = Math.min(rise.length, f + around)
    const mean = (sum[hi] - sum[lo]) / (hi - lo)
    if (v < mean * 1.5 + loudest * 0.05) continue
    let isMax = true
    for (
      let g = Math.max(0, f - near);
      g <= Math.min(rise.length - 1, f + near);
      g++
    )
      if (rise[g] > v || (rise[g] === v && g < f)) {
        isMax = false
        break
      }
    if (!isMax || !loudEnough(f)) continue
    const last = out[out.length - 1]
    if (last && f - last.frame < minGap) {
      if (v > last.strength) out[out.length - 1] = { frame: f, strength: v }
      continue
    }
    out.push({ frame: f, strength: v })
  }
  return out.map((p) => ({ ...p, strength: p.strength / loudest }))
}

/**
 * Drum hits from a drum stem: low thumps as kicks, mid-range cracks as
 * snares and bright ticks (that aren't the snare's own rattle) as hi-hats.
 */
export function drumHits(samples: Float32Array, sr = STEM_RATE): FoundNote[] {
  const hop = DRUM_HOP / sr
  const lowBand = onsetStrength(biquad(samples, sr, "low", 110))
  const midBand = onsetStrength(biquad(samples, sr, "band", 1800, 0.8))
  const highBand = onsetStrength(biquad(samples, sr, "high", 7000))
  const low = pickPeaks(lowBand, sr, 0.09)
  // Snares and hats both crack: find the hits in either band, then tell
  // them apart by which band is louder just after the hit (a hat is
  // brighter, a snare has more body).
  const after = Math.round(0.03 / hop)
  const loudest = (rms: Float32Array, f: number) => {
    let m = 0
    for (let g = f; g <= Math.min(rms.length - 1, f + after); g++)
      m = Math.max(m, rms[g])
    return m
  }
  const cracks: { frame: number; strength: number }[] = []
  for (const p of [
    ...pickPeaks(midBand, sr, 0.06),
    ...pickPeaks(highBand, sr, 0.06),
  ].sort((x, y) => x.frame - y.frame)) {
    const last = cracks[cracks.length - 1]
    if (last && (p.frame - last.frame) * hop <= 0.03) {
      last.strength = Math.max(last.strength, p.strength)
      continue
    }
    cracks.push({ ...p })
  }
  const hit = (pitch: number, frame: number, strength: number): FoundNote => ({
    pitch,
    start: frame * hop,
    end: frame * hop + 0.1,
    velocity: Math.round(50 + 77 * Math.min(1, strength)),
  })
  const notes: FoundNote[] = low.map((p) => hit(KICK, p.frame, p.strength))
  // How much body each crack has (mid against high, as a log ratio), and
  // the split between bright (hats) and full (snares) for this recording.
  const body = cracks.map((c) =>
    Math.log(
      (loudest(midBand.rms, c.frame) + 1e-6) /
        (loudest(highBand.rms, c.frame) + 1e-6)
    )
  )
  const split = twoGroups(body)
  for (const [i, c] of cracks.entries()) {
    // A kick spills into the mid band too, so a crack on a kick (often a
    // hat played with it) must be clearly full to count as a snare, and
    // louder than the kick's own click.
    const kick = low.find((k) => Math.abs(k.frame - c.frame) * hop <= 0.03)
    const snare = kick
      ? body[i] >= split + 0.7 && c.strength * 1.3 >= kick.strength
      : body[i] >= split
    notes.push(
      snare
        ? hit(SNARE, c.frame, c.strength)
        : hit(HAT, c.frame, c.strength * 0.8)
    )
  }
  return notes.sort((x, y) => x.start - y.start || x.pitch - y.pitch)
}

/**
 * Where to split values into two groups (two-means). When they don't form
 * two clear groups, everything goes on the side its average is on: bright
 * hits are all hats, full ones all snares.
 */
export function twoGroups(values: number[]) {
  if (values.length < 4) return 0
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2
    const a = values.filter((v) => v < mid)
    const b = values.filter((v) => v >= mid)
    if (!a.length || !b.length) break
    lo = a.reduce((x, y) => x + y, 0) / a.length
    hi = b.reduce((x, y) => x + y, 0) / b.length
  }
  // Under about 1.6 times apart: one kind of hit.
  if (hi - lo < 0.5) {
    const mean = values.reduce((x, y) => x + y, 0) / values.length
    return mean < 0 ? Infinity : -Infinity
  }
  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------
// Tempo and the beat.

/** Onset strength from notes: each start, weighted by loudness. */
export function onsetEnvelope(
  notes: FoundNote[],
  hop: number,
  seconds: number
) {
  const env = new Float32Array(Math.ceil(seconds / hop) + 1)
  for (const n of notes) {
    const i = Math.round(n.start / hop)
    if (i >= 0 && i < env.length) env[i] += n.velocity / 127
  }
  return env
}

/**
 * Where the beats fall: the offset (0 to one beat, seconds) at which
 * beats line up with the most onsets.
 */
export function beatOffset(env: Float32Array, hop: number, bpm: number) {
  const beat = 60 / bpm
  const steps = 48
  let best = 0
  let bestScore = -1
  for (let s = 0; s < steps; s++) {
    const offset = (s / steps) * beat
    let score = 0
    for (let t = offset; t / hop < env.length; t += beat) {
      const i = Math.round(t / hop)
      // A little either side, for loose timing.
      score += env[i] + 0.5 * ((env[i - 1] ?? 0) + (env[i + 1] ?? 0))
    }
    if (score > bestScore) {
      bestScore = score
      best = offset
    }
  }
  return best
}

/** The song's tempo and beat offset, from the drums if there are any. */
/** Onset strength for songTempo: a value every this many seconds. */
export const ENV_HOP = 0.01

/**
 * The song's tempo, where its beats fall, and the onset strength they were
 * found from (to place the beat again at another tempo). From the drums if
 * there are enough hits, otherwise from every note.
 */
export function songTempo(
  stems: { id: StemId; notes: FoundNote[] }[],
  seconds: number
) {
  const hop = ENV_HOP
  const drums = stems.find((s) => s.id === "drums")?.notes ?? []
  const pitched = stems.filter((s) => s.id !== "drums").flatMap((s) => s.notes)
  const source = drums.length >= 16 ? drums : [...drums, ...pitched]
  const env = onsetEnvelope(source, hop, seconds)
  if (source.length < 8) return { bpm: 120, offset: 0, env }
  const bpm = tempoFromEnvelope(env, hop)
  return { bpm, offset: beatOffset(env, hop, bpm), env }
}

/**
 * Notes moved so the song's beats land on the bars: by the shorter way,
 * earlier (up to half a beat; anything before the start is clamped to it)
 * or later.
 */
export function alignToBeat(notes: FoundNote[], bpm: number, offset: number) {
  const beat = 60 / bpm
  const o = ((offset % beat) + beat) % beat
  const shift = o <= beat / 2 ? -o : beat - o
  if (Math.abs(shift) < 1e-9) return notes
  return notes.map((n) => ({
    ...n,
    start: Math.max(0, n.start + shift),
    end: Math.max(0.01, n.end + shift),
  }))
}

// ---------------------------------------------------------------------------
// MIDI.

/** The stems' notes as one multi-part MIDI song (for the importer). */
export function stemsToParsedMidi(
  stems: { id: StemId; notes: FoundNote[] }[],
  bpm: number
): ParsedMidi {
  const beat = (s: number) => (s * bpm) / 60
  const parts = stems
    .filter((s) => s.notes.length)
    .map((s) => {
      const info = STEMS.find((i) => i.id === s.id)!
      const notes: RawNote[] = s.notes.map((n) => ({
        pitch: n.pitch,
        start: beat(n.start),
        end: beat(n.end),
        velocity: n.velocity,
      }))
      return {
        id: s.id,
        name: info.partName,
        channel: s.id === "drums" ? 9 : STEMS.indexOf(info),
        program: null,
        notes,
        isDrums: s.id === "drums",
      }
    })
  return {
    bpm,
    keySig: null,
    timeSig: [4, 4],
    parts,
    length: Math.max(0, ...parts.flatMap((p) => p.notes.map((n) => n.end))),
  }
}

/** The stems' notes as events on the song's tracks, for playback and export. */
export function stemsToEvents(
  stems: { id: StemId; notes: FoundNote[] }[],
  bpm: number
): NoteEvent[] {
  return stems.flatMap((s) => {
    const track = STEMS.find((i) => i.id === s.id)!.track
    return s.notes.map((n) => ({
      midi: n.pitch,
      start: (n.start * bpm) / 60,
      duration: ((n.end - n.start) * bpm) / 60,
      velocity: n.velocity,
      track,
    }))
  })
}

// ---------------------------------------------------------------------------
// Running it.

/** Whether this browser can try (it needs workers and WebAssembly). */
export function canSplit() {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined"
}

/** Whether the model has been downloaded before. */
export async function modelSaved() {
  try {
    const cache = await caches.open(MODEL_CACHE)
    return !!(await cache.match(MODEL_URL))
  } catch {
    return false
  }
}

/** A song decoded for the model: stereo at 44.1 kHz. */
export async function decodeStereo(file: Blob) {
  const ctx = new OfflineAudioContext(2, 1, 44100)
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  // Copies, so they can be handed to the worker.
  const left = buffer.getChannelData(0).slice()
  const right =
    buffer.numberOfChannels > 1
      ? buffer.getChannelData(1).slice()
      : left.slice()
  return { left, right, sampleRate: buffer.sampleRate }
}

/** Split a song into stems and find their notes, in a worker. */
export function splitSong(
  song: WorkerIn,
  {
    onProgress,
    onBackend,
    signal,
  }: {
    onProgress: (p: StemsProgress) => void
    onBackend?: (gpu: boolean) => void
    signal?: AbortSignal
  }
): Promise<Stem[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./stems.worker.ts", import.meta.url), {
      type: "module",
    })
    const stop = () => {
      worker.terminate()
      reject(new DOMException("Cancelled", "AbortError"))
    }
    if (signal?.aborted) return stop()
    signal?.addEventListener("abort", stop, { once: true })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === "progress") onProgress(m.progress)
      else if (m.type === "backend") onBackend?.(m.gpu)
      else {
        signal?.removeEventListener("abort", stop)
        worker.terminate()
        if (m.type === "done") resolve(m.stems)
        else reject(new Error(m.message))
      }
    }
    worker.onerror = (e) => {
      signal?.removeEventListener("abort", stop)
      worker.terminate()
      reject(new Error(e.message || "The splitter stopped unexpectedly."))
    }
    worker.postMessage(song, [song.left.buffer, song.right.buffer])
  })
}

/**
 * Notes as one line, as a voice sings them: where two overlap, the earlier
 * one stops when the later one starts. Notes starting together, or a much
 * quieter one inside another (usually an overtone), keep only the louder.
 */
export function oneLine(notes: FoundNote[]) {
  const out: FoundNote[] = []
  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || b.velocity - a.velocity
  )
  for (const n of sorted) {
    const last = out[out.length - 1]
    if (last && n.start < last.end) {
      const together = n.start - last.start < 0.05
      if (together || n.velocity < last.velocity - 25) {
        if (together && n.velocity > last.velocity)
          out[out.length - 1] = { ...n }
        continue
      }
      last.end = n.start
    }
    out.push({ ...n })
  }
  return out
}

/**
 * Notes of a part that plays several at once (chords, drums) lined up with
 * the beat: each pitch is snapped on its own, so a chord stays a chord.
 */
export function snapParts(notes: FoundNote[], bpm: number, snap: Snap) {
  if (snap === "off") return notes
  const byPitch = new Map<number, FoundNote[]>()
  for (const n of notes)
    byPitch.set(n.pitch, [...(byPitch.get(n.pitch) ?? []), n])
  return [...byPitch.values()]
    .flatMap((list) => snapNotes(list, bpm, snap))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

/**
 * A sung line tidied: a held note the model heard as several pieces (the
 * same pitch with no gap) becomes one, and blips under 0.1 s right next to
 * a note a tone or less away are folded into it (slides and wobbles).
 */
export function smoothLine(notes: FoundNote[]) {
  const out: FoundNote[] = []
  for (const n of notes.map((x) => ({ ...x }))) {
    const last = out[out.length - 1]
    const touching = last && n.start - last.end <= 0.04
    if (touching && n.pitch === last.pitch && n.start - last.end <= 0.02) {
      last.end = Math.max(last.end, n.end)
      continue
    }
    if (
      touching &&
      Math.abs(n.pitch - last.pitch) <= 2 &&
      n.end - n.start < 0.1
    ) {
      last.end = Math.max(last.end, n.end)
      continue
    }
    if (
      touching &&
      Math.abs(n.pitch - last.pitch) <= 2 &&
      last.end - last.start < 0.1
    ) {
      // The blip came first: the note takes its place.
      out[out.length - 1] = { ...n, start: last.start }
      continue
    }
    out.push(n)
  }
  return out
}

/**
 * Notes in the guitars & keys that are really the bass showing through:
 * below C3, the bass's own pitch, starting with it.
 */
export function withoutBleed(notes: FoundNote[], bass: FoundNote[]) {
  return notes.filter(
    (n) =>
      n.pitch >= 48 ||
      !bass.some(
        (b) => b.pitch === n.pitch && Math.abs(b.start - n.start) < 0.1
      )
  )
}
