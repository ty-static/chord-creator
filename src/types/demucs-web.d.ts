// demucs-web ships plain JavaScript; these are the parts this app uses.
declare module "demucs-web" {
  export const CONSTANTS: {
    SAMPLE_RATE: number
    TRAINING_SAMPLES: number
    MODEL_SPEC_BINS: number
    MODEL_SPEC_FRAMES: number
    SEGMENT_OVERLAP: number
    TRACKS: string[]
  }
  export interface TrackSpec {
    leftReal: Float32Array
    leftImag: Float32Array
    rightReal: Float32Array
    rightImag: Float32Array
  }
  export function prepareModelInput(
    left: Float32Array,
    right: Float32Array
  ): { waveform: Float32Array; magSpec: Float32Array }
  export function standaloneMask(freqOutput: Float32Array): TrackSpec[]
  export function standaloneIspec(
    spec: TrackSpec,
    length: number
  ): { left: Float32Array; right: Float32Array }
}
