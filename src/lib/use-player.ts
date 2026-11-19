import * as React from "react"

import type { TrackName } from "@/lib/arrange"
import { type Voice, engine } from "@/lib/audio-engine"
import type { TrackInstruments } from "@/lib/instruments"
import {
  type CountIn,
  type PlaySettings,
  type Transport,
  advance,
  beatAt,
  createTransport,
  instrumentsKey,
  replan,
} from "@/lib/scheduler"

export type { PlaySettings }

const TRACKS: TrackName[] = ["chords", "melody", "bass", "drums"]

async function loadVoices(instruments: TrackInstruments) {
  const voices = await Promise.all(
    TRACKS.map((t) => engine.voice(instruments[t], t))
  )
  return {
    ...(Object.fromEntries(TRACKS.map((t, i) => [t, voices[i]])) as Record<
      TrackName,
      Voice
    >),
    click: engine.clickVoice(),
  }
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
    // When the song ends, let the last notes ring out naturally.
    if (advance(tr, engine.context().currentTime)) halt()
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
      replan(tr, engine.context().currentTime)
      pump()
      const key = instrumentsKey(settings.instruments)
      if (key === tr.instrumentsKey) return
      // New instrument: keep playing with the old one until it has loaded.
      const voices = await loadVoices(settings.instruments)
      if (
        transportRef.current !== tr ||
        instrumentsKey(tr.settings.instruments) !== key
      )
        return
      tr.voices = voices
      tr.instrumentsKey = key
      replan(tr, engine.context().currentTime)
      pump()
    },
    [pump]
  )

  const play = React.useCallback(
    async (settings: PlaySettings, from: number, countIn?: CountIn) => {
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

      transportRef.current = {
        ...createTransport({
          token,
          voices,
          settings: latest,
          from,
          now: ctx.currentTime,
          countIn,
        }),
        instrumentsKey: instrumentsKey(settings.instruments),
      }
      // Instruments changed while loading: switch over once they're ready.
      if (
        instrumentsKey(latest.instruments) !==
        instrumentsKey(settings.instruments)
      )
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
