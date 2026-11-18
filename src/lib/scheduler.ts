// Playback scheduling, kept free of React and the Web Audio graph so it can be
// tested with a fake clock. `use-player.ts` drives it with a real AudioContext.

import type { NoteEvent, TrackName } from "@/lib/arrange"
import type { Release, Voice } from "@/lib/audio-engine"
import type { TrackInstruments } from "@/lib/instruments"
import {
  type TempoChange,
  bpmAt,
  nextChange,
  secondsBetween,
  steadyTempo,
} from "@/lib/tempo"

/** Everything the player needs to know about the music. Can change while playing. */
export interface PlaySettings {
  events: NoteEvent[]
  bpm: number
  /** Tempo changes, if the song has any (otherwise `bpm` throughout). */
  tempo?: TempoChange[]
  /** End of the song in beats. */
  end: number
  loop: boolean
  /** Section to repeat when looping (defaults to the whole song). */
  loopStart?: number
  loopEnd?: number
  instruments: TrackInstruments
}

/** Audio scheduling runs this far ahead of the clock (seconds). It's longer
 *  than background-tab timer throttling (~1s), so loops stay seamless in a
 *  hidden tab; edits still apply at once because future notes are cancelled. */
export const LOOKAHEAD = 1.5
/** Notes are scheduled in slices of this many beats. */
export const CHUNK = 0.5
/** An edit takes effect this long after it happens (seconds). */
export const EDIT_LATENCY = 0.05
/** Delay between pressing Play and the first note (seconds). */
export const START_DELAY = 0.12

/** A point where the playhead jumps or the tempo changes. */
export interface Anchor {
  time: number
  beat: number
  spb: number
}

export interface Transport {
  token: number
  voices: Record<TrackName, Pick<Voice, "start">>
  instrumentsKey: string
  settings: PlaySettings
  /** Next beat to schedule, and the audio time it plays at. */
  cursorBeat: number
  cursorTime: number
  /** Also start notes that are already sounding at the cursor (after a jump). */
  carry: boolean
  anchors: Anchor[]
  /** Notes scheduled but maybe not started yet, so edits can cancel them. */
  scheduled: { time: number; release: Release | void }[]
  /** Audio time the song ends (when not looping), once known. */
  endTime: number | null
  /** Audio time the music starts (after any count-in); edits don't move it. */
  startTime: number
}

/** A bar of clicks before the music: its length and where the clicks fall, in beats. */
export interface CountIn {
  beats: number
  clicks: number[]
}

/** The click of a count-in: a closed hi-hat, louder on beat 1. */
export const CLICK_NOTE = 42

/** The settings' tempo map. */
export const tempoOf = (s: PlaySettings) =>
  s.tempo?.length ? s.tempo : steadyTempo(s.bpm)

/** Seconds per beat at a beat. */
const spbAt = (s: PlaySettings, beat: number) => 60 / bpmAt(tempoOf(s), beat)

export const instrumentsKey = (i: TrackInstruments) => JSON.stringify(i)

/** The section that plays: the loop range when looping, otherwise the whole song. */
export function bounds(s: PlaySettings) {
  if (!s.loop) return { start: 0, stop: s.end }
  const start = Math.max(0, Math.min(s.loopStart ?? 0, s.end))
  const stop = Math.min(s.loopEnd ?? s.end, s.end)
  return stop > start ? { start, stop } : { start: 0, stop: s.end }
}

/** Start a transport at beat `from`, with the first note at audio time `now + START_DELAY`. */
export function createTransport(opts: {
  token: number
  voices: Transport["voices"]
  settings: PlaySettings
  from: number
  now: number
  countIn?: CountIn
}): Transport {
  const { settings } = opts
  const { start, stop } = bounds(settings)
  const begin =
    settings.loop && (opts.from < start || opts.from >= stop)
      ? start
      : opts.from
  // The count-in clicks at the tempo the music starts in.
  const spb = spbAt(settings, begin)
  const clicksAt = opts.now + START_DELAY
  const t0 = clicksAt + (opts.countIn?.beats ?? 0) * spb
  const scheduled: Transport["scheduled"] = (opts.countIn?.clicks ?? []).map(
    (beat, i) => {
      const time = clicksAt + beat * spb
      return {
        time,
        release: opts.voices.drums.start({
          note: CLICK_NOTE,
          time,
          duration: 0.1,
          velocity: i === 0 ? 120 : 84,
        }),
      }
    }
  )
  return {
    token: opts.token,
    voices: opts.voices,
    instrumentsKey: instrumentsKey(settings.instruments),
    settings,
    cursorBeat: begin,
    cursorTime: t0,
    carry: true,
    anchors: [{ time: t0, beat: begin, spb }],
    scheduled,
    endTime: null,
    startTime: t0,
  }
}

/** Song position (in beats) at an audio time. */
export function beatAt(tr: Transport, time: number) {
  let a = tr.anchors[0]
  for (const x of tr.anchors) if (x.time <= time) a = x
  return a.beat + Math.max(0, time - a.time) / a.spb
}

/** Schedule one slice of notes at the cursor. Returns false once the song has ended. */
export function scheduleChunk(tr: Transport) {
  const s = tr.settings
  const tempo = tempoOf(s)
  const { start, stop } = bounds(s)
  if (tr.cursorBeat >= stop) {
    if (!s.loop || stop <= start) {
      tr.endTime = tr.cursorTime
      return false
    }
    tr.cursorBeat = start
    tr.carry = true
    tr.anchors.push({ time: tr.cursorTime, beat: start, spb: spbAt(s, start) })
  }
  const from = tr.cursorBeat
  // A slice never spans a tempo change, so its tempo is steady.
  const to = Math.min(stop, from + CHUNK, nextChange(tempo, from))
  const spb = spbAt(s, from)
  if (tr.anchors.at(-1)!.spb !== spb)
    tr.anchors.push({ time: tr.cursorTime, beat: from, spb })
  for (const e of s.events) {
    const end = e.start + e.duration
    const starts = e.start >= from && e.start < to
    const sounding = tr.carry && e.start < from && end > from
    if (!starts && !sounding) continue
    const at = Math.max(e.start, from)
    const time = tr.cursorTime + (at - from) * spb
    const release = tr.voices[e.track].start({
      note: e.midi,
      time,
      // Clip at the loop/song end so nothing hangs over the jump.
      duration: secondsBetween(tempo, at, Math.min(end, stop)),
      velocity: e.velocity,
    })
    tr.scheduled.push({ time, release })
  }
  tr.carry = false
  tr.cursorTime += (to - from) * spb
  tr.cursorBeat = to
  return true
}

/**
 * Schedule everything up to `now + LOOKAHEAD` and tidy up.
 * Returns true once the song has finished playing.
 */
export function advance(tr: Transport, now: number) {
  while (tr.endTime === null && tr.cursorTime < now + LOOKAHEAD)
    if (!scheduleChunk(tr)) break
  if (tr.endTime !== null && now >= tr.endTime) return true
  // Forget notes that have started, and anchors that are behind us.
  tr.scheduled = tr.scheduled.filter((n) => n.time > now - 0.05)
  while (tr.anchors.length > 1 && tr.anchors[1].time <= now) tr.anchors.shift()
  return false
}

/**
 * Re-plan from `now + EDIT_LATENCY` with the transport's current settings:
 * notes that haven't started are cancelled, and the cursor restarts there.
 * Call `advance` afterwards to schedule the new notes.
 */
export function replan(tr: Transport, now: number) {
  // During a count-in, the music still starts when it was going to.
  const t = Math.max(now + EDIT_LATENCY, tr.startTime)
  let b = beatAt(tr, t)
  tr.scheduled = tr.scheduled.filter((n) => {
    if (n.time < t) return true
    n.release?.()
    return false
  })
  const { start, stop } = bounds(tr.settings)
  tr.carry = false
  tr.endTime = null
  if (tr.settings.loop && (b < start || b >= stop)) {
    b = start
    tr.carry = true
  }
  tr.anchors = tr.anchors.filter((a) => a.time < t)
  tr.anchors.push({ time: t, beat: b, spb: spbAt(tr.settings, b) })
  tr.cursorBeat = b
  tr.cursorTime = t
}
