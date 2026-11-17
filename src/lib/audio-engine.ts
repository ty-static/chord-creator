// Sampled-instrument audio engine built on smplr.
// Instruments are loaded lazily from free sample CDNs and cached; if loading
// fails (e.g. offline) the track falls back to a built-in oscillator synth.
//
// Signal flow:  instrument → track bus (volume · mute/solo) ─┬→ master → compressor → out
//                                                            └→ reverb send → reverb → master
import {
  CacheStorage,
  DrumMachine,
  Reverb,
  Soundfont,
  SplendidGrandPiano,
} from "smplr"

import type { TrackName } from "@/lib/arrange"
import { MIDI_TO_PIECE } from "@/lib/drums"
import { INSTRUMENTS, TRACK_RANGE } from "@/lib/instruments"

export interface PlayNote {
  note: number
  time: number // AudioContext seconds
  duration: number // seconds
  velocity: number // 0..127
}

/**
 * Ends a note early: releases a held note, or cancels one scheduled for the
 * future (used by live keyboard input and by edits during playback).
 */
export type Release = () => void

export interface Voice {
  start(n: PlayNote): Release | void
  stop(): void
}

export interface TrackMix {
  volume: number // 0..1
  mute: boolean
  solo: boolean
}
export type Mix = Record<TrackName, TrackMix>

export const DEFAULT_MIX: Mix = {
  chords: { volume: 0.8, mute: false, solo: false },
  melody: { volume: 0.85, mute: false, solo: false },
  bass: { volume: 0.8, mute: false, solo: false },
  drums: { volume: 0.75, mute: false, solo: false },
}

const TRACKS: TrackName[] = ["chords", "melody", "bass", "drums"]
const TRACK_VOLUME: Record<TrackName, number> = {
  chords: 100,
  melody: 112,
  bass: 118,
  drums: 110,
}

/** Reverb send relative to the global reverb amount (drums stay drier). */
const SEND_SCALE: Record<TrackName, number> = {
  chords: 1,
  melody: 1,
  bass: 0.3,
  drums: 0.35,
}

const SYNTH: Record<
  TrackName,
  { wave: OscillatorType; gain: number; cutoff: number; release: number }
> = {
  chords: { wave: "triangle", gain: 0.09, cutoff: 2200, release: 0.25 },
  melody: { wave: "sawtooth", gain: 0.09, cutoff: 1800, release: 0.12 },
  bass: { wave: "sine", gain: 0.28, cutoff: 600, release: 0.15 },
  drums: { wave: "sine", gain: 0.3, cutoff: 8000, release: 0.1 }, // unused: drums use synthDrumVoice
}

// Persist downloaded samples in the browser's Cache Storage so later visits load instantly.
const storage =
  typeof caches !== "undefined"
    ? CacheStorage("chord-creator-samples")
    : undefined

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Effective gain of each track after volume, mute and solo. */
export function trackGains(mix: Mix): Record<TrackName, number> {
  const anySolo = TRACKS.some((t) => mix[t].solo)
  return Object.fromEntries(
    TRACKS.map((t) => {
      const m = mix[t]
      const audible = !m.mute && (!anySolo || m.solo)
      return [t, audible ? m.volume : 0]
    })
  ) as Record<TrackName, number>
}

export interface EngineStatus {
  loading: string[] // instrument labels currently downloading
  failed: string[] // instrument labels that fell back to the synth
}

interface Bus {
  input: GainNode
  send: GainNode
}

class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private reverb!: ReturnType<typeof Reverb>
  private buses!: Record<TrackName, Bus>
  private voices = new Map<string, Promise<Voice>>()
  private live = new Set<Voice>()
  private reverbMix = 0.25
  private gains: Record<TrackName, number> = trackGains(DEFAULT_MIX)
  private listeners = new Set<() => void>()
  status: EngineStatus = { loading: [], failed: [] }

  context() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" })
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 3
      this.master = ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(comp).connect(ctx.destination)
      this.reverb = Reverb(ctx)
      this.reverb.connect(this.master)
      this.ctx = ctx
      this.buses = Object.fromEntries(
        TRACKS.map((t) => {
          const input = ctx.createGain()
          const send = ctx.createGain()
          input.connect(this.master)
          input.connect(send).connect(this.reverb.input)
          return [t, { input, send }]
        })
      ) as Record<TrackName, Bus>
      this.applyMix(0)
    }
    return this.ctx
  }

  async resume() {
    const ctx = this.context()
    if (ctx.state !== "running") await ctx.resume()
    return ctx
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private setStatus(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((l) => l())
  }

  setReverb(mix: number) {
    this.reverbMix = mix
    this.applyMix()
  }

  setMix(mix: Mix) {
    this.gains = trackGains(mix)
    this.applyMix()
  }

  private applyMix(ramp = 0.03) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const t of TRACKS) {
      const { input, send } = this.buses[t]
      input.gain.setTargetAtTime(this.gains[t], now, ramp || 0.001)
      send.gain.setTargetAtTime(
        this.reverbMix * SEND_SCALE[t],
        now,
        ramp || 0.001
      )
    }
  }

  /** Get (loading if needed) the voice for an instrument on a given track. */
  voice(instrumentId: string, track: TrackName): Promise<Voice> {
    const key = `${track}:${instrumentId}`
    let p = this.voices.get(key)
    if (!p) {
      p = this.load(instrumentId, track)
      this.voices.set(key, p)
    }
    return p
  }

  stopAll() {
    this.live.forEach((v) => v.stop())
  }

  private async load(instrumentId: string, track: TrackName): Promise<Voice> {
    const ctx = this.context()
    const def = INSTRUMENTS[instrumentId] ?? INSTRUMENTS.basic_synth
    const fallback = () =>
      track === "drums" ? this.synthDrumVoice() : this.synthVoice(track)
    if (def.source.kind === "synth") return this.track(fallback())

    const [lo, hi] = TRACK_RANGE[track]
    const notes = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    const common = {
      destination: this.buses[track].input,
      ...(storage ? { storage } : {}),
      volume: TRACK_VOLUME[track],
      notesToLoad: { notes, fallback: "nearest" as const },
    }

    this.setStatus({ loading: [...this.status.loading, def.label] })
    try {
      if (def.source.kind === "drums") {
        const { machine, map } = def.source
        const kit = DrumMachine(ctx, {
          instrument: machine,
          destination: this.buses[track].input,
          ...(storage ? { storage } : {}),
          volume: TRACK_VOLUME[track],
        })
        await Promise.race([
          kit.ready,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 45_000)
          ),
        ])
        // Resolve each piece to a sample group this kit actually has.
        const groups = kit.getGroupNames()
        const samples = kit.getSampleNames()
        const resolve = (name: string) =>
          groups.includes(name)
            ? name
            : (samples.find((s) => s === name || s.startsWith(name + "/")) ??
              null)
        const names = Object.fromEntries(
          Object.entries(map).map(([piece, name]) => [piece, resolve(name)])
        )
        return this.track({
          start: (n) => {
            const piece = MIDI_TO_PIECE[n.note]
            const name = piece && names[piece]
            if (!name) return
            const stopHit = kit.start({
              note: name,
              time: n.time,
              velocity: n.velocity,
            })
            return () => stopHit()
          },
          stop: () => kit.stop(),
        })
      }

      const inst =
        def.source.kind === "piano"
          ? SplendidGrandPiano(ctx, {
              ...common,
              decayTime: 0.6,
              notesToLoad: { ...common.notesToLoad, velocityRange: [72, 96] },
            })
          : Soundfont(ctx, {
              ...common,
              instrument: def.source.name,
              kit: "MusyngKite",
            })

      await Promise.race([
        inst.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 45_000)
        ),
      ])

      return this.track({
        start: (n) => {
          const stopNote = inst.start({
            note: n.note,
            time: n.time,
            duration: n.duration,
            velocity: n.velocity,
          })
          return () => stopNote()
        },
        stop: () => inst.stop(),
      })
    } catch (err) {
      console.warn(`Could not load ${def.label}, using built-in synth`, err)
      this.setStatus({
        failed: [...new Set([...this.status.failed, def.label])],
      })
      this.voices.delete(`${track}:${instrumentId}`) // allow a retry later
      return this.track(fallback())
    } finally {
      const loading = [...this.status.loading]
      loading.splice(loading.indexOf(def.label), 1)
      this.setStatus({ loading })
    }
  }

  private track(v: Voice) {
    this.live.add(v)
    return v
  }

  private noise: AudioBuffer | null = null

  /** Synthesized drum kit, used offline or as the "Basic Synth" drum choice. */
  private synthDrumVoice(): Voice {
    const ctx = this.context()
    const out = this.buses.drums.input
    if (!this.noise) {
      const len = ctx.sampleRate
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      this.noise = buf
    }
    const noiseBuf = this.noise
    const sources = new Set<AudioScheduledSourceNode>()
    let batch: AudioScheduledSourceNode[] = [] // sources made by the current hit
    const track = (s: AudioScheduledSourceNode) => {
      sources.add(s)
      batch.push(s)
      s.onended = () => sources.delete(s)
    }
    const stopSource = (s: AudioScheduledSourceNode) => {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }

    const env = (t: number, peak: number, decay: number) => {
      const g = ctx.createGain()
      g.gain.setValueAtTime(peak, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      g.connect(out)
      return g
    }
    const tone = (
      t: number,
      f0: number,
      f1: number,
      decay: number,
      peak: number
    ) => {
      const osc = ctx.createOscillator()
      osc.frequency.setValueAtTime(f0, t)
      osc.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.6)
      osc.connect(env(t, peak, decay))
      osc.start(t)
      osc.stop(t + decay + 0.05)
      track(osc)
    }
    const noise = (
      t: number,
      type: BiquadFilterType,
      freq: number,
      decay: number,
      peak: number
    ) => {
      const src = ctx.createBufferSource()
      src.buffer = noiseBuf
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      src.connect(f).connect(env(t, peak, decay))
      src.start(t)
      src.stop(t + decay + 0.05)
      track(src)
    }

    return {
      start: ({ note, time: t, velocity }) => {
        const v = velocity / 127
        batch = []
        switch (MIDI_TO_PIECE[note]) {
          case "kick":
            tone(t, 150, 45, 0.45, 0.9 * v)
            break
          case "snare":
            tone(t, 220, 160, 0.12, 0.3 * v)
            noise(t, "bandpass", 1800, 0.2, 0.5 * v)
            break
          case "clap":
            for (const d of [0, 0.012, 0.024])
              noise(t + d, "bandpass", 1200, d === 0.024 ? 0.18 : 0.02, 0.5 * v)
            break
          case "hat":
            noise(t, "highpass", 7000, 0.05, 0.25 * v)
            break
          case "openhat":
            noise(t, "highpass", 6500, 0.35, 0.22 * v)
            break
          case "tom":
            tone(t, 200, 110, 0.35, 0.6 * v)
            break
          case "crash":
            noise(t, "highpass", 4500, 1.4, 0.3 * v)
            break
        }
        const hit = batch
        return () => hit.forEach(stopSource)
      },
      stop: () => {
        sources.forEach((s) => {
          try {
            s.stop()
          } catch {
            /* already stopped */
          }
        })
        sources.clear()
      },
    }
  }

  /** Oscillator fallback with the same interface as a sampled instrument. */
  private synthVoice(track: TrackName): Voice {
    const ctx = this.context()
    const out = this.buses[track].input
    const oscs = new Set<OscillatorNode>()
    const v = SYNTH[track]
    return {
      start: (n) => {
        const osc = ctx.createOscillator()
        const filter = ctx.createBiquadFilter()
        const gain = ctx.createGain()
        osc.type = v.wave
        osc.frequency.value = midiToHz(n.note)
        filter.frequency.value = v.cutoff
        const peak = v.gain * (n.velocity / 100)
        const end = n.time + n.duration
        gain.gain.setValueAtTime(0, n.time)
        gain.gain.linearRampToValueAtTime(peak, n.time + 0.01)
        gain.gain.exponentialRampToValueAtTime(peak * 0.6, n.time + 0.2)
        gain.gain.setValueAtTime(peak * 0.6, end)
        gain.gain.exponentialRampToValueAtTime(0.0001, end + v.release)
        osc.connect(filter).connect(gain).connect(out)
        osc.start(n.time)
        osc.stop(end + v.release + 0.05)
        oscs.add(osc)
        osc.onended = () => oscs.delete(osc)
        return () => {
          const now = ctx.currentTime
          if (now >= end) return
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + v.release)
          try {
            osc.stop(now + v.release + 0.05)
          } catch {
            /* already stopped */
          }
        }
      },
      stop: () => {
        oscs.forEach((o) => {
          try {
            o.stop()
          } catch {
            /* already stopped */
          }
        })
        oscs.clear()
      },
    }
  }
}

export const engine = new AudioEngine()
