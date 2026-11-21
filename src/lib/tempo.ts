// Tempo changes: a section can play faster or slower than the song, and can
// slow down over its last bars (a ritardando). The result is a tempo map, a
// list of tempo changes in beats, used by playback, WAV and MIDI export.

import type { Song } from "@/lib/arrange"
import { layout, sectionMeter } from "@/lib/arrange"
import { barBeats } from "@/lib/meter"

export interface TempoChange {
  /** From this beat of the song on… */
  beat: number
  /** …the music plays at this many quarter notes a minute. */
  bpm: number
}

/** The song's tempo range, in BPM. */
export const MIN_BPM = 50
export const MAX_BPM = 200

/** A tempo typed or tapped in, rounded and kept in range. */
export const clampBpm = (bpm: number) =>
  Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)))

/** Taps further apart than this start a new count. */
export const TAP_RESET_MS = 2000

/**
 * The tempo of a run of taps (times in ms, oldest first): the average gap
 * between the last few, once there are two. Null until then.
 */
export function tapTempo(times: number[]): number | null {
  // Only the taps since the last long pause, and at most the last eight.
  let from = times.length - 1
  while (from > 0 && times[from] - times[from - 1] <= TAP_RESET_MS) from--
  const run = times.slice(Math.max(from, times.length - 8))
  if (run.length < 2) return null
  const gap = (run.at(-1)! - run[0]) / (run.length - 1)
  return gap > 0 ? clampBpm(60_000 / gap) : null
}

/** Section tempos, as a percentage of the song's tempo. */
export const SECTION_TEMPOS: { value: number; label: string }[] = [
  { value: 50, label: "Half time" },
  { value: 75, label: "Slower" },
  { value: 90, label: "A little slower" },
  { value: 110, label: "A little faster" },
  { value: 125, label: "Faster" },
  { value: 150, label: "Much faster" },
  { value: 200, label: "Double time" },
]
export const MIN_SECTION_TEMPO = 25
export const MAX_SECTION_TEMPO = 200

export const sectionTempoLabel = (pct: number) =>
  SECTION_TEMPOS.find((t) => t.value === pct)?.label ?? `${pct}%`

/** A slow-down takes at most this many bars, and ends at this much of the tempo. */
export const SLOW_DOWN_BARS = 2
export const SLOW_DOWN_TO = 0.7

/** The tempo map of a song: always starts at beat 0, no two changes alike in a row. */
export function tempoMap(song: Song): TempoChange[] {
  const out: TempoChange[] = []
  const push = (beat: number, bpm: number) => {
    bpm = Math.round(bpm * 10) / 10
    const last = out.at(-1)
    if (last?.bpm === bpm) return
    if (last && Math.abs(last.beat - beat) < 1e-9) last.bpm = bpm
    else out.push({ beat, bpm })
  }
  push(0, song.bpm)
  for (const p of layout(song)) {
    const bar = barBeats(sectionMeter(song, p.section))
    const bpm = (song.bpm * (p.section.tempo ?? 100)) / 100
    push(p.start, bpm)
    if (!p.section.slowDown || p.beats <= 0) continue
    // Slow down in half-beat steps over the last bars.
    const span = Math.min(SLOW_DOWN_BARS * bar, Math.floor(p.beats) / 2)
    const steps = Math.round(span * 2)
    const from = p.start + p.beats - steps / 2
    for (let k = 0; k < steps; k++)
      push(from + k / 2, bpm * (1 - ((1 - SLOW_DOWN_TO) * (k + 1)) / steps))
  }
  // The ending (after the form) keeps the last tempo.
  return out
}

/** A tempo map with one tempo throughout. */
export const steadyTempo = (bpm: number): TempoChange[] => [{ beat: 0, bpm }]

/** The tempo at a beat. */
export function bpmAt(map: TempoChange[], beat: number) {
  let bpm = map[0]?.bpm ?? 120
  for (const t of map) if (t.beat <= beat + 1e-9) bpm = t.bpm
  return bpm
}

/** The first beat after `beat` where the tempo changes (Infinity if none). */
export function nextChange(map: TempoChange[], beat: number) {
  return map.find((t) => t.beat > beat + 1e-9)?.beat ?? Infinity
}

/** Seconds from the start of the song to a beat. */
export function secondsAt(map: TempoChange[], beat: number) {
  let secs = 0
  for (let i = 0; i < map.length; i++) {
    const from = i === 0 ? 0 : map[i].beat
    if (beat <= from) break
    const to = Math.min(beat, map[i + 1]?.beat ?? Infinity)
    secs += ((to - from) * 60) / map[i].bpm
  }
  return secs
}

/** Seconds between two beats. */
export const secondsBetween = (map: TempoChange[], a: number, b: number) =>
  secondsAt(map, b) - secondsAt(map, a)

/** Whether the song changes tempo anywhere. */
export const hasTempoChanges = (map: TempoChange[]) => map.length > 1

/**
 * The tempo from how an onset curve repeats: the beat length (60–180 BPM)
 * at which it best lines up with itself, favouring tempos near 110.
 */
export function tempoFromEnvelope(env: Float32Array, hop: number) {
  let best = 120
  let bestScore = -Infinity
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = 60 / bpm / hop
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
