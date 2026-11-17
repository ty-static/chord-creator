import * as React from "react"

import type { NoteEvent, TrackName } from "@/lib/arrange"
import { type Release, type Voice, engine } from "@/lib/audio-engine"
import type { TrackInstruments } from "@/lib/instruments"

const TRACKS: TrackName[] = ["chords", "melody", "bass", "drums"]

async function loadVoices(instruments: TrackInstruments) {
  const voices = await Promise.all(
    TRACKS.map((t) => engine.voice(instruments[t], t))
  )
  return Object.fromEntries(TRACKS.map((t, i) => [t, voices[i]])) as Record<
    TrackName,
    Voice
  >
}

/** Everything the player needs to know about the music. Can change while playing. */
export interface PlaySettings {
  events: NoteEvent[]
  bpm: number
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
const LOOKAHEAD = 1.5
/** Notes are scheduled in slices of this many beats. */
const CHUNK = 0.5
/** An edit takes effect this long after it happens (seconds). */
const EDIT_LATENCY = 0.05

/** A point where the playhead jumps or the tempo changes. */
interface Anchor {
  time: number
  beat: number
  spb: number
}

interface Transport {
  token: number
  ctx: AudioContext
  voices: Record<TrackName, Voice>
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
}

const keyOf = (i: TrackInstruments) => JSON.stringify(i)

function bounds(s: PlaySettings) {
  if (!s.loop) return { start: 0, stop: s.end }
  const start = Math.max(0, Math.min(s.loopStart ?? 0, s.end))
  const stop = Math.min(s.loopEnd ?? s.end, s.end)
  return stop > start ? { start, stop } : { start: 0, stop: s.end }
}

function beatAt(tr: Transport, time: number) {
  let a = tr.anchors[0]
  for (const x of tr.anchors) if (x.time <= time) a = x
  return a.beat + Math.max(0, time - a.time) / a.spb
}

/** Schedule one slice of notes at the cursor. Returns false once the song has ended. */
function scheduleChunk(tr: Transport) {
  const s = tr.settings
  const spb = 60 / s.bpm
  const { start, stop } = bounds(s)
  if (tr.cursorBeat >= stop) {
    if (!s.loop || stop <= start) {
      tr.endTime = tr.cursorTime
      return false
    }
    tr.cursorBeat = start
    tr.carry = true
    tr.anchors.push({ time: tr.cursorTime, beat: start, spb })
  }
  const from = tr.cursorBeat
  const to = Math.min(stop, from + CHUNK)
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
      duration: (Math.min(end, stop) - at) * spb,
      velocity: e.velocity,
    })
    tr.scheduled.push({ time, release })
  }
  tr.carry = false
  tr.cursorTime += (to - from) * spb
  tr.cursorBeat = to
  return true
}

/** Re-plan everything from shortly after now, using the transport's current settings. */
function replan(tr: Transport, pump: () => void) {
  const t = tr.ctx.currentTime + EDIT_LATENCY
  let b = beatAt(tr, t)
  // Cancel notes that haven't started yet; they are rescheduled below.
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
  tr.anchors.push({ time: t, beat: b, spb: 60 / tr.settings.bpm })
  tr.cursorBeat = b
  tr.cursorTime = t
  pump()
}

/** Plays NoteEvents through the sampled-instrument engine and reports a beat playhead.
 *  `update` swaps the music while playing, without stopping. */
export function usePlayer() {
  const rafRef = React.useRef(0)
  const timerRef = React.useRef(0)
  const tokenRef = React.useRef(0)
  const transportRef = React.useRef<Transport | null>(null)
  /** True while `play` waits for instruments; edits made then are kept here. */
  const startingRef = React.useRef(false)
  const pendingRef = React.useRef<PlaySettings | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [beat, setBeat] = React.useState<number | null>(null)

  const status = React.useSyncExternalStore(
    engine.subscribe,
    () => engine.status
  )

  const halt = React.useCallback(() => {
    tokenRef.current++
    transportRef.current = null
    startingRef.current = false
    pendingRef.current = null
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    setPlaying(false)
    setLoading(false)
    setBeat(null)
  }, [])

  const stop = React.useCallback(() => {
    halt()
    engine.stopAll()
  }, [halt])

  const pump = React.useCallback(() => {
    const tr = transportRef.current
    if (!tr || tr.token !== tokenRef.current) return
    const now = tr.ctx.currentTime
    while (tr.endTime === null && tr.cursorTime < now + LOOKAHEAD)
      if (!scheduleChunk(tr)) break
    if (tr.endTime !== null && now >= tr.endTime) {
      halt() // let the last notes ring out naturally
      return
    }
    // Forget notes that have started, and anchors that are behind us.
    tr.scheduled = tr.scheduled.filter((n) => n.time > now - 0.05)
    while (tr.anchors.length > 1 && tr.anchors[1].time <= now)
      tr.anchors.shift()
  }, [halt])

  /** Swap in new music while playing. Does nothing when stopped. */
  const update = React.useCallback(
    async (settings: PlaySettings) => {
      const tr = transportRef.current
      if (!tr) {
        if (startingRef.current) pendingRef.current = settings
        return
      }
      tr.settings = settings
      replan(tr, pump)
      const key = keyOf(settings.instruments)
      if (key === tr.instrumentsKey) return
      // New instrument: keep playing with the old one until it has loaded.
      const voices = await loadVoices(settings.instruments)
      if (transportRef.current !== tr || keyOf(tr.settings.instruments) !== key)
        return
      tr.voices = voices
      tr.instrumentsKey = key
      replan(tr, pump)
    },
    [pump]
  )

  const play = React.useCallback(
    async (settings: PlaySettings, from: number) => {
      stop()
      if (settings.end <= 0) return
      const token = tokenRef.current
      setLoading(true)
      startingRef.current = true
      const ctx = await engine.resume()
      const voices = await loadVoices(settings.instruments)
      if (token !== tokenRef.current) return // stopped or restarted while loading
      startingRef.current = false
      // The music may have been edited while instruments loaded.
      const latest = pendingRef.current ?? settings
      pendingRef.current = null
      setLoading(false)
      setPlaying(true)

      const { start, stop: end } = bounds(latest)
      const begin = latest.loop && (from < start || from >= end) ? start : from
      const t0 = ctx.currentTime + 0.12
      transportRef.current = {
        token,
        ctx,
        voices,
        instrumentsKey: keyOf(settings.instruments),
        settings: latest,
        cursorBeat: begin,
        cursorTime: t0,
        carry: true,
        anchors: [{ time: t0, beat: begin, spb: 60 / latest.bpm }],
        scheduled: [],
        endTime: null,
      }
      // Instruments changed while loading: switch over once they're ready.
      if (keyOf(latest.instruments) !== keyOf(settings.instruments))
        void update(latest)
      pump()
      timerRef.current = window.setInterval(pump, 100)

      const draw = () => {
        const tr = transportRef.current
        if (!tr || tr.token !== token) return
        setBeat(beatAt(tr, ctx.currentTime))
        rafRef.current = requestAnimationFrame(draw)
      }
      rafRef.current = requestAnimationFrame(draw)
    },
    [stop, pump, update]
  )

  /** Audition notes immediately (clicking a chord or drawing a melody note). */
  const preview = React.useCallback(
    async (midis: number[], track: TrackName, instrumentId: string) => {
      const ctx = await engine.resume()
      const voice = await engine.voice(instrumentId, track)
      const time = ctx.currentTime + 0.01
      for (const note of midis)
        voice.start({ note, time, duration: 0.8, velocity: 90 })
    },
    []
  )

  /** Start downloading instruments ahead of time so Play is instant. */
  const preload = React.useCallback((instruments: TrackInstruments) => {
    for (const t of TRACKS) void engine.voice(instruments[t], t)
  }, [])

  React.useEffect(() => stop, [stop])

  return {
    play,
    update,
    stop,
    preview,
    preload,
    playing,
    loading,
    beat,
    status,
  }
}
