import * as React from "react"

import type { NoteEvent, TrackName } from "@/lib/arrange"
import { type Voice, engine } from "@/lib/audio-engine"
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

export interface PlayRange {
  /** Beat to start playing from. */
  from: number
  /** End of the song in beats. */
  end: number
  loop: boolean
  /** Section to repeat when looping (defaults to the whole song). */
  loopStart?: number
  loopEnd?: number
}

/** Plays NoteEvents through the sampled-instrument engine and reports a beat playhead. */
export function usePlayer() {
  const rafRef = React.useRef(0)
  const timerRef = React.useRef(0)
  const tokenRef = React.useRef(0)
  const [playing, setPlaying] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [beat, setBeat] = React.useState<number | null>(null)

  const status = React.useSyncExternalStore(
    engine.subscribe,
    () => engine.status
  )

  const stop = React.useCallback(() => {
    tokenRef.current++
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    engine.stopAll()
    setPlaying(false)
    setLoading(false)
    setBeat(null)
  }, [])

  const play = React.useCallback(
    async (
      events: NoteEvent[],
      bpm: number,
      range: PlayRange,
      instruments: TrackInstruments
    ) => {
      stop()
      if (range.end <= 0) return
      const token = tokenRef.current
      setLoading(true)
      const ctx = await engine.resume()
      const voices = await loadVoices(instruments)
      if (token !== tokenRef.current) return // stopped or restarted while loading
      setLoading(false)
      setPlaying(true)

      const spb = 60 / bpm
      const loopStart = range.loopStart ?? 0
      const loopEnd = Math.min(range.loopEnd ?? range.end, range.end)

      /** Schedule the notes sounding in [from, to) beats, starting at audio time t0. */
      const schedule = (from: number, to: number, t0: number) => {
        for (const e of events) {
          const end = e.start + e.duration
          if (end <= from || e.start >= to) continue
          // Notes already sounding at `from` (e.g. a held chord) start immediately.
          const start = Math.max(e.start, from)
          voices[e.track].start({
            note: e.midi,
            time: t0 + (start - from) * spb,
            duration: (Math.min(end, to) - start) * spb,
            velocity: e.velocity,
          })
        }
      }

      // Played segments, in audio time. The first may start mid-song; later ones are loop repeats.
      let from = range.from
      if (range.loop && (from < loopStart || from >= loopEnd)) from = loopStart
      const segs = [
        {
          from,
          to: range.loop ? loopEnd : range.end,
          t0: ctx.currentTime + 0.12,
        },
      ]
      const segEnd = (s: (typeof segs)[number]) => s.t0 + (s.to - s.from) * spb
      schedule(segs[0].from, segs[0].to, segs[0].t0)
      let queuedEnd = segEnd(segs[0])

      const finish = () => {
        tokenRef.current++ // let the last notes ring out naturally
        cancelAnimationFrame(rafRef.current)
        clearInterval(timerRef.current)
        setPlaying(false)
        setBeat(null)
      }

      // Audio scheduling runs on a timer (not animation frames, which pause in
      // background tabs). It looks ahead further than background-tab timer
      // throttling (~1s) so loops stay seamless even when the tab is hidden.
      const LOOKAHEAD = 1.5
      const pump = () => {
        if (token !== tokenRef.current) return
        const now = ctx.currentTime
        if (range.loop && loopEnd > loopStart) {
          while (queuedEnd < now + LOOKAHEAD) {
            schedule(loopStart, loopEnd, queuedEnd)
            segs.push({ from: loopStart, to: loopEnd, t0: queuedEnd })
            queuedEnd = segEnd(segs[segs.length - 1])
          }
          while (segs.length > 1 && segEnd(segs[0]) <= now) segs.shift()
        } else if (now >= queuedEnd) {
          finish()
        }
      }
      timerRef.current = window.setInterval(pump, 100)

      const draw = () => {
        if (token !== tokenRef.current) return
        pump()
        const now = ctx.currentTime
        const seg = segs.find((s) => now < segEnd(s)) ?? segs[segs.length - 1]
        setBeat(seg.from + Math.max(0, (now - seg.t0) / spb))
        rafRef.current = requestAnimationFrame(draw)
      }
      rafRef.current = requestAnimationFrame(draw)
    },
    [stop]
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

  return { play, stop, preview, preload, playing, loading, beat, status }
}
