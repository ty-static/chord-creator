// Splits a song into stems and finds their notes, away from the page so it
// stays responsive. Separation: HTDemucs (Meta, MIT licence) as ONNX, run
// with ONNX Runtime Web on the GPU (WebGPU) or the CPU (WebAssembly).
// Notes: Basic Pitch (Spotify, Apache 2.0), run with TensorFlow.js.

import * as tf from "@tensorflow/tfjs"
import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch"
import pitchModelUrl from "@spotify/basic-pitch/model/model.json?url"
import pitchWeightsUrl from "@spotify/basic-pitch/model/group1-shard1of1.bin?url"
import {
  CONSTANTS,
  prepareModelInput,
  standaloneIspec,
  standaloneMask,
} from "demucs-web"
import * as ort from "onnxruntime-web/webgpu"

import type { FoundNote } from "@/lib/audio-to-midi"
import {
  MODEL_CACHE,
  MODEL_MB,
  MODEL_URL,
  STEM_RATE,
  type Stem,
  type StemId,
  type StemsProgress,
  type WorkerIn,
  type WorkerOut,
  drumHits,
  oneLine,
  smoothLine,
  withoutBleed,
} from "@/lib/stems"

// TensorFlow.js 3 checks `!window` (a bare name) when it waits for the GPU;
// in a worker that throws inside a timer and the wait never ends. With the
// name defined (as undefined) it takes its plain setTimeout path.
;(self as unknown as { window?: undefined }).window = undefined

const post = (m: WorkerOut, transfer: Transferable[] = []) =>
  self.postMessage(m, { transfer })
const progress = (p: StemsProgress) => post({ type: "progress", progress: p })

/** The model, from this device's cache or downloaded (and then kept). */
async function loadModel(): Promise<ArrayBuffer> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(MODEL_CACHE)
    const hit = await cache.match(MODEL_URL)
    if (hit) return await hit.arrayBuffer()
  } catch {
    // No cache storage (private mode): download every time.
  }
  let res: Response
  try {
    res = await fetch(MODEL_URL)
  } catch {
    throw new Error(
      "Couldn't download the instrument splitter. Check the connection and try again."
    )
  }
  if (!res.ok || !res.body)
    throw new Error(
      `Couldn't download the instrument splitter (error ${res.status}). Try again later.`
    )
  const total =
    Number(res.headers.get("Content-Length")) || MODEL_MB * 1024 * 1024
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let last = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (loaded - last > 512 * 1024) {
      last = loaded
      progress({ step: "download", loaded, total: Math.max(total, loaded) })
    }
  }
  const bytes = new Uint8Array(loaded)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.length
  }
  try {
    await cache?.put(MODEL_URL, new Response(bytes.slice()))
  } catch {
    // Out of space: it's downloaded again next time.
  }
  return bytes.buffer
}

async function openSession(model: ArrayBuffer) {
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1
  const options = { graphOptimizationLevel: "basic" as const }
  if ("gpu" in navigator) {
    try {
      const session = await ort.InferenceSession.create(model, {
        ...options,
        executionProviders: ["webgpu"],
      })
      return { session, gpu: true }
    } catch {
      // No usable GPU: the CPU it is.
    }
  }
  const session = await ort.InferenceSession.create(model, {
    ...options,
    executionProviders: ["wasm"],
  })
  return { session, gpu: false }
}

const ORDER: StemId[] = ["drums", "bass", "other", "vocals"]

/**
 * The four stems, mono at STEM_RATE. The song goes through the model a
 * window (about 8 s) at a time; windows overlap by a quarter and are
 * cross-faded.
 */
async function separate(
  session: ort.InferenceSession,
  left: Float32Array,
  right: Float32Array
) {
  const T = CONSTANTS.TRAINING_SAMPLES
  const stride = Math.floor(T * (1 - CONSTANTS.SEGMENT_OVERLAP))
  const total = left.length
  const windows = Math.max(1, Math.ceil(Math.max(0, total - T) / stride) + 1)
  const outLength = Math.ceil(total / 2)
  const outs = ORDER.map(() => new Float32Array(outLength))
  const weight = new Float32Array(outLength)
  progress({ step: "split", progress: 0 })

  for (let k = 0; k < windows; k++) {
    const start = k * stride
    const end = Math.min(start + T, total)
    const length = end - start
    const segL = new Float32Array(T)
    const segR = new Float32Array(T)
    segL.set(left.subarray(start, end))
    segR.set(right.subarray(start, end))
    const input = prepareModelInput(segL, segR)
    const feeds: Record<string, ort.Tensor> = {
      [session.inputNames[0]]: new ort.Tensor("float32", input.waveform, [
        1,
        2,
        T,
      ]),
    }
    if (session.inputNames.length > 1)
      feeds[session.inputNames[1]] = new ort.Tensor("float32", input.magSpec, [
        1,
        4,
        CONSTANTS.MODEL_SPEC_BINS,
        CONSTANTS.MODEL_SPEC_FRAMES,
      ])
    const results = await session.run(feeds)

    let time: Float32Array | null = null
    let samples = 0
    let freq: Float32Array | null = null
    for (const name of session.outputNames) {
      const t = results[name]
      if (t.dims.length === 4 && t.dims[2] === 2) {
        time = t.data as Float32Array
        samples = t.dims[3]
      } else if (t.dims.length === 5 && t.dims[2] === 4)
        freq = t.data as Float32Array
    }
    if (!time) throw new Error("The instrument splitter gave no sound back.")
    const specs = freq ? standaloneMask(freq) : null

    for (let s = 0; s < ORDER.length; s++) {
      const extra = specs ? standaloneIspec(specs[s], T) : null
      const l = s * 2 * samples
      const r = l + samples
      const out = outs[s]
      for (let i = 0; i < length; i++) {
        const fade = Math.min(1, i / (stride / 2), (length - i) / (stride / 2))
        let v = time[l + i] + time[r + i]
        if (extra) v += extra.left[i] + extra.right[i]
        // Mono, and two samples into one (44.1 to 22.05 kHz).
        out[(start + i) >> 1] += (v / 2) * fade
        if (s === 0) weight[(start + i) >> 1] += fade
      }
    }
    for (const t of Object.values(results)) t.dispose()
    progress({ step: "split", progress: (k + 1) / windows })
  }

  for (const out of outs)
    for (let i = 0; i < outLength; i++) if (weight[i] > 0) out[i] /= weight[i]
  return Object.fromEntries(ORDER.map((id, i) => [id, outs[i]])) as Record<
    StemId,
    Float32Array
  >
}

/** How notes are picked out of each pitched stem. */
const PITCH_SETTINGS: Record<
  Exclude<StemId, "drums">,
  {
    onset: number
    frame: number
    minFrames: number
    minHz: number | null
    maxHz: number | null
  }
> = {
  vocals: { onset: 0.5, frame: 0.3, minFrames: 11, minHz: 70, maxHz: 1400 },
  other: { onset: 0.5, frame: 0.3, minFrames: 11, minHz: null, maxHz: null },
  bass: { onset: 0.4, frame: 0.3, minFrames: 11, minHz: 30, maxHz: 400 },
}

async function pitchModel() {
  // The GPU when it can; otherwise the CPU (slower).
  try {
    if (!(await tf.setBackend("webgl"))) await tf.setBackend("cpu")
  } catch {
    await tf.setBackend("cpu")
  }
  await tf.ready()
  const [json, weights] = await Promise.all([
    fetch(pitchModelUrl).then((r) => r.json()),
    fetch(pitchWeightsUrl).then((r) => r.arrayBuffer()),
  ])
  return new BasicPitch(
    tf.loadGraphModel(
      tf.io.fromMemory({
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest[0].weights,
        weightData: weights,
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        signature: json.signature,
      })
    )
  )
}

async function findNotes(
  bp: BasicPitch,
  id: Exclude<StemId, "drums">,
  audio: Float32Array
): Promise<FoundNote[]> {
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await bp.evaluateModel(
    audio,
    (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    (p) => progress({ step: "notes", stem: id, progress: p })
  )
  const s = PITCH_SETTINGS[id]
  const notes = noteFramesToTime(
    outputToNotesPoly(
      frames,
      onsets,
      s.onset,
      s.frame,
      s.minFrames,
      true,
      s.maxHz,
      s.minHz,
      true
    )
  ).map((n) => ({
    pitch: n.pitchMidi,
    start: n.startTimeSeconds,
    end: n.startTimeSeconds + n.durationSeconds,
    velocity: Math.max(1, Math.min(127, Math.round(40 + 87 * n.amplitude))),
  }))
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  // A voice sings one note at a time.
  return id === "vocals" ? smoothLine(oneLine(notes)) : notes
}

const fail = (err: unknown) =>
  post({
    type: "error",
    message:
      err instanceof Error && err.message
        ? err.message
        : "Couldn't split the song.",
  })
// Anything thrown where it can't be caught still ends the job.
self.addEventListener("unhandledrejection", (e) => fail(e.reason))
self.addEventListener("error", (e) => fail(e.error ?? new Error(e.message)))

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    const { left, right, sampleRate } = e.data
    if (sampleRate !== CONSTANTS.SAMPLE_RATE)
      throw new Error("The song must be at 44.1 kHz.")
    const { session, gpu } = await openSession(await loadModel())
    post({ type: "backend", gpu })
    const audio = await separate(session, left, right)
    await session.release()

    const bp = await pitchModel()
    const stems: Stem[] = []
    for (const id of ["vocals", "other", "bass"] as const)
      stems.push({
        id,
        audio: audio[id],
        notes: await findNotes(bp, id, audio[id]),
      })
    // The bass is found last: take what leaked into the guitars & keys out.
    const bass = stems.find((s) => s.id === "bass")!.notes
    const other = stems.find((s) => s.id === "other")!
    other.notes = withoutBleed(other.notes, bass)
    progress({ step: "notes", stem: "drums", progress: 0 })
    stems.push({
      id: "drums",
      audio: audio.drums,
      notes: drumHits(audio.drums, STEM_RATE),
    })
    progress({ step: "notes", stem: "drums", progress: 1 })
    post(
      { type: "done", stems },
      stems.map((s) => s.audio.buffer as ArrayBuffer)
    )
  } catch (err) {
    fail(err)
  }
}
