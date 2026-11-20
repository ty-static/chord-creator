// Recording from the microphone, as raw samples (so the take can be saved as
// a WAV with a proper length, which MediaRecorder's WebM files don't have).
// It can click along: a bar of count-in, then a click on every beat, made
// in the same audio context as the capture so the take can be cut exactly
// at the first downbeat.

import { encodeWav } from "@/lib/wav"

/** A finished take: mono samples at the microphone's rate. */
export interface Take {
  samples: Float32Array
  sampleRate: number
  /** Recorded to a click at this tempo: the take starts on the first beat. */
  bpm?: number
}

/** Clicking along while recording. */
export interface Click {
  bpm: number
  beatsPerBar: number
}

export interface Recorder {
  /** Seconds recorded so far (after the count-in, with a click). */
  seconds: () => number
  /** How loud the last moment was, 0–1 (for a level meter). */
  level: () => number
  /**
   * With a click: beats since the first downbeat, negative during the
   * count-in (-4 to 0 in 4/4). Null without one.
   */
  beat: () => number | null
  /** Stop and get the take. */
  stop: () => Promise<Take>
  /** Stop and throw the take away. */
  cancel: () => void
}

/** Why recording couldn't start, in words for the page. */
export class MicError extends Error {}

/** A block of input, and the context frame it started at. */
export interface Chunk {
  frame: number
  data: Float32Array
}

/** The worklet that hands each block of input back to the page. */
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage({ frame: currentFrame, data: ch.slice(0) })
    return true
  }
}
registerProcessor("tap", Tap)
`

/** Clicks are scheduled this far ahead (seconds), topped up every 25 ms. */
const LOOK_AHEAD = 0.15

export function canRecord() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined"
  )
}

/** Ask for the microphone and start recording. */
export async function startRecording({
  maxSeconds,
  onLimit,
  click,
}: {
  maxSeconds: number
  /** Called once when the take reaches `maxSeconds` (it stops growing). */
  onLimit?: () => void
  /** Count in one bar, then click on every beat. */
  click?: Click
}): Promise<Recorder> {
  if (!canRecord())
    throw new MicError("This browser can't record from a microphone.")
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Leave the sound alone: these are made for speech and smear pitch.
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ""
    throw new MicError(
      name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access is blocked. Allow it in the browser's site settings, then try again."
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No microphone found. Plug one in, or check it's turned on."
          : name === "NotReadableError"
            ? "The microphone is busy in another app. Close it there and try again."
            : "Couldn't start the microphone."
    )
  }

  const ctx = new AudioContext()
  const sr = ctx.sampleRate
  const chunks: Chunk[] = []
  let length = 0
  let level = 0
  let done = false
  // With a click the count-in doesn't count towards the limit.
  const countIn = click ? (click.beatsPerBar * 60) / click.bpm : 0
  const max = Math.round((maxSeconds + countIn + 1) * sr)
  const take = (frame: number, block: Float32Array) => {
    if (done) return
    let peak = 0
    for (const v of block) peak = Math.max(peak, Math.abs(v))
    level = Math.max(peak, level * 0.85)
    if (length >= max) return
    const room = Math.min(block.length, max - length)
    chunks.push({
      frame,
      data: room < block.length ? block.slice(0, room) : block,
    })
    length += room
    if (length >= max) onLimit?.()
  }

  const source = ctx.createMediaStreamSource(stream)
  // Nothing is heard: the tap only needs to be pulled by the graph.
  const mute = ctx.createGain()
  mute.gain.value = 0
  mute.connect(ctx.destination)
  let tap: AudioNode
  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(
      new Blob([WORKLET], { type: "text/javascript" })
    )
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const node = new AudioWorkletNode(ctx, "tap", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    })
    node.port.onmessage = (e: MessageEvent<Chunk>) =>
      take(e.data.frame, e.data.data)
    tap = node
  } else {
    // Older browsers.
    const node = ctx.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (e) =>
      take(
        Math.round(e.playbackTime * sr),
        new Float32Array(e.inputBuffer.getChannelData(0))
      )
    tap = node
  }
  source.connect(tap)
  tap.connect(mute)
  if (ctx.state === "suspended") await ctx.resume()

  // The click: the count-in starts a moment from now, and the take starts
  // on the beat after it.
  const start = ctx.currentTime + 0.3
  const beatLength = click ? 60 / click.bpm : 0
  const downbeat = start + countIn
  let next = 0
  let timer = 0
  if (click) {
    const schedule = () => {
      while (start + next * beatLength < ctx.currentTime + LOOK_AHEAD) {
        playClick(
          ctx,
          start + next * beatLength,
          next % click.beatsPerBar === 0
        )
        next++
      }
    }
    schedule()
    timer = window.setInterval(schedule, 25)
  }

  // What's sung on a beat reaches us later than the beat's time: by the
  // time the click takes to be heard and the voice to be captured.
  const latency = () => {
    const input = stream.getAudioTracks()[0]?.getSettings() as
      (MediaTrackSettings & { latency?: number }) | undefined
    return (
      (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + (input?.latency || 0)
    )
  }

  const close = () => {
    done = true
    window.clearInterval(timer)
    stream.getTracks().forEach((t) => t.stop())
    source.disconnect()
    tap.disconnect()
    void ctx.close()
  }
  return {
    seconds: () =>
      click ? Math.max(0, ctx.currentTime - downbeat) : length / sr,
    level: () => level,
    beat: () => (click ? (ctx.currentTime - downbeat) / beatLength : null),
    stop: async () => {
      const lag = latency()
      close()
      if (!click) return { samples: joinChunks(chunks), sampleRate: sr }
      return {
        samples: alignChunks(chunks, Math.round((downbeat + lag) * sr)),
        sampleRate: sr,
        bpm: click.bpm,
      }
    },
    cancel: close,
  }
}

/** One click: a short blip, higher on the first beat of a bar. */
function playClick(ctx: AudioContext, t: number, accent: boolean) {
  const osc = ctx.createOscillator()
  osc.frequency.value = accent ? 1760 : 1320
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.05)
}

export function joinChunks(chunks: (Float32Array | Chunk)[]) {
  const data = chunks.map((c) => (c instanceof Float32Array ? c : c.data))
  const out = new Float32Array(data.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of data) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * The take from context frame `from` on: earlier input is dropped (the
 * count-in), and if the input started later, silence fills the gap.
 */
export function alignChunks(chunks: Chunk[], from: number) {
  if (!chunks.length) return new Float32Array(0)
  const first = chunks[0].frame
  const all = joinChunks(chunks)
  const skip = from - first
  if (skip >= 0) return all.subarray(Math.min(skip, all.length))
  const out = new Float32Array(all.length - skip)
  out.set(all, -skip)
  return out
}

/**
 * Cut the quiet before the first sound and after the last (keeping a little
 * of each), so the first note lands near the start of bar 1. `start: false`
 * keeps the beginning (a take to a click already starts on the beat).
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  { keep = 0.1, threshold = 0.05, start = true } = {}
) {
  const block = Math.max(1, Math.round(sampleRate * 0.01))
  const blocks = Math.ceil(samples.length / block)
  const peak = new Float32Array(blocks)
  let loudest = 0
  for (let b = 0; b < blocks; b++) {
    let m = 0
    const end = Math.min(samples.length, (b + 1) * block)
    for (let i = b * block; i < end; i++) m = Math.max(m, Math.abs(samples[i]))
    peak[b] = m
    loudest = Math.max(loudest, m)
  }
  if (loudest === 0) return samples
  const loud = (b: number) => peak[b] >= loudest * threshold
  let first = 0
  while (first < blocks && !loud(first)) first++
  let last = blocks - 1
  while (last > first && !loud(last)) last--
  const pad = Math.round(keep * sampleRate)
  const from = start ? Math.max(0, first * block - pad) : 0
  const to = Math.min(samples.length, (last + 1) * block + pad)
  return samples.subarray(from, to)
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")

/** A take as a WAV file, named for the day it was made ("Recording 19 Nov 2026"). */
export function takeToFile(take: Take, when = new Date()) {
  const name = `Recording ${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}.wav`
  const bytes = encodeWav(
    [trimSilence(take.samples, take.sampleRate, { start: !take.bpm })],
    take.sampleRate
  )
  return new File([bytes], name, { type: "audio/wav" })
}
