// Recording from the microphone, as raw samples (so the take can be saved as
// a WAV with a proper length, which MediaRecorder's WebM files don't have).

import { encodeWav } from "@/lib/wav"

/** A finished take: mono samples at the microphone's rate. */
export interface Take {
  samples: Float32Array
  sampleRate: number
}

export interface Recorder {
  /** Seconds recorded so far. */
  seconds: () => number
  /** How loud the last moment was, 0–1 (for a level meter). */
  level: () => number
  /** Stop and get the take. */
  stop: () => Promise<Take>
  /** Stop and throw the take away. */
  cancel: () => void
}

/** Why recording couldn't start, in words for the page. */
export class MicError extends Error {}

/** The worklet that hands each block of input back to the page. */
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor("tap", Tap)
`

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
}: {
  maxSeconds: number
  /** Called once when the take reaches `maxSeconds` (it stops growing). */
  onLimit?: () => void
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
  const chunks: Float32Array[] = []
  let length = 0
  let level = 0
  let done = false
  const max = Math.round(maxSeconds * ctx.sampleRate)
  const take = (block: Float32Array) => {
    if (done) return
    let peak = 0
    for (const v of block) peak = Math.max(peak, Math.abs(v))
    level = Math.max(peak, level * 0.85)
    if (length >= max) return
    const room = Math.min(block.length, max - length)
    chunks.push(room < block.length ? block.slice(0, room) : block)
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
    node.port.onmessage = (e: MessageEvent<Float32Array>) => take(e.data)
    tap = node
  } else {
    // Older browsers.
    const node = ctx.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (e) =>
      take(new Float32Array(e.inputBuffer.getChannelData(0)))
    tap = node
  }
  source.connect(tap)
  tap.connect(mute)
  if (ctx.state === "suspended") await ctx.resume()

  const close = () => {
    done = true
    stream.getTracks().forEach((t) => t.stop())
    source.disconnect()
    tap.disconnect()
    void ctx.close()
  }
  return {
    seconds: () => length / ctx.sampleRate,
    level: () => level,
    stop: async () => {
      const sampleRate = ctx.sampleRate
      close()
      return { samples: joinChunks(chunks), sampleRate }
    },
    cancel: close,
  }
}

export function joinChunks(chunks: Float32Array[]) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * Cut the quiet before the first sound and after the last (keeping a little
 * of each), so the first note lands near the start of bar 1.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  { keep = 0.1, threshold = 0.05 } = {}
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
  const from = Math.max(0, first * block - pad)
  const to = Math.min(samples.length, (last + 1) * block + pad)
  return samples.subarray(from, to)
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")

/** A take as a WAV file, named for the day it was made ("Recording 19 Nov 2026"). */
export function takeToFile(take: Take, when = new Date()) {
  const name = `Recording ${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}.wav`
  const bytes = encodeWav(
    [trimSilence(take.samples, take.sampleRate)],
    take.sampleRate
  )
  return new File([bytes], name, { type: "audio/wav" })
}
