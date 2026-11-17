import type { ChordStyle, Song } from "@/lib/arrange"
import { DEFAULT_MIX } from "@/lib/audio-engine"
import { DEFAULT_DRUMS, presetPattern } from "@/lib/drums"
import type { TrackInstruments } from "@/lib/instruments"
import {
  type Chord,
  type ChordType,
  type Key,
  generateMelody,
  uid,
} from "@/lib/music"

export interface Example {
  id: string
  label: string
  description: string
  build: () => Song
}

interface Spec {
  key: Key
  bpm: number
  degrees: number[]
  type?: ChordType | ChordType[]
  beats?: number
  style: ChordStyle
  instruments: TrackInstruments
  density: number
  seed: number
  reverb?: number
  voiceLeading?: boolean
  bass?: boolean
  /** Drum preset id; omit for no drums. */
  drums?: string
  fill?: boolean
  crash?: boolean
}

function make(spec: Spec): Song {
  const chords: Chord[] = spec.degrees.map((degree, i) => ({
    id: uid(),
    degree,
    type: Array.isArray(spec.type)
      ? spec.type[i % spec.type.length]
      : (spec.type ?? "triad"),
    inversion: 0,
    beats: spec.beats ?? 4,
  }))
  return {
    key: spec.key,
    bpm: spec.bpm,
    chords,
    melody: generateMelody(chords, { density: spec.density, seed: spec.seed }),
    chordStyle: spec.style,
    bass: spec.bass ?? true,
    instruments: spec.instruments,
    reverb: spec.reverb ?? 0.25,
    mix: structuredClone(DEFAULT_MIX),
    voiceLeading: spec.voiceLeading ?? true,
    drums: spec.drums
      ? {
          enabled: true,
          pattern: presetPattern(spec.drums),
          fill: spec.fill ?? false,
          crashAtStart: spec.crash ?? false,
        }
      : { ...DEFAULT_DRUMS, enabled: false },
  }
}

export const EXAMPLES: Example[] = [
  {
    id: "pop",
    label: "Pop Anthem",
    description: "C major · I–V–vi–IV · 112 BPM",
    build: () =>
      make({
        key: { root: 0, scale: "major" },
        bpm: 112,
        degrees: [0, 4, 5, 3],
        style: "pulse",
        instruments: {
          chords: "grand_piano",
          melody: "electric_piano",
          bass: "finger_bass",
          drums: "kit_lm2",
        },
        drums: "pop",
        crash: true,
        density: 0.6,
        seed: 1201,
      }),
  },
  {
    id: "lofi",
    label: "Lo-fi Evening",
    description: "F major · ii7–V7–Imaj7–vi7 · 76 BPM",
    build: () =>
      make({
        key: { root: 5, scale: "major" },
        bpm: 76,
        degrees: [1, 4, 0, 5],
        type: "seventh",
        style: "arpeggio",
        instruments: {
          chords: "electric_piano",
          melody: "vibraphone",
          bass: "acoustic_bass",
          drums: "kit_rz1",
        },
        drums: "lofi",
        density: 0.4,
        seed: 3307,
        reverb: 0.4,
      }),
  },
  {
    id: "spanish",
    label: "Spanish Nights",
    description: "A minor · Andalusian cadence · 96 BPM",
    build: () =>
      make({
        key: { root: 9, scale: "minor" },
        bpm: 96,
        degrees: [0, 6, 5, 4],
        style: "arpeggio",
        instruments: {
          chords: "nylon_guitar",
          melody: "flute",
          bass: "acoustic_bass",
          drums: "kit_lm2",
        },
        density: 0.55,
        seed: 4412,
        reverb: 0.3,
      }),
  },
  {
    id: "epic",
    label: "Epic Score",
    description: "D minor · i–VI–III–VII · 84 BPM",
    build: () =>
      make({
        key: { root: 2, scale: "minor" },
        bpm: 84,
        degrees: [0, 5, 2, 6],
        style: "block",
        instruments: {
          chords: "choir",
          melody: "strings",
          bass: "fretless_bass",
          drums: "kit_cr8000",
        },
        drums: "halftime",
        crash: true,
        density: 0.35,
        seed: 5520,
        reverb: 0.5,
      }),
  },
  {
    id: "dreamy",
    label: "Dreamy Lydian",
    description: "E♭ Lydian · Imaj7–II7–vi7–V7 · 90 BPM",
    build: () =>
      make({
        key: { root: 3, scale: "lydian" },
        bpm: 90,
        degrees: [0, 1, 5, 4],
        type: "seventh",
        style: "block",
        instruments: {
          chords: "new_age_pad",
          melody: "marimba",
          bass: "synth_bass",
          drums: "kit_808",
        },
        density: 0.5,
        seed: 6631,
        reverb: 0.45,
      }),
  },
  {
    id: "rock",
    label: "Classic Rock",
    description: "G Mixolydian · I–♭VII–IV–I · 124 BPM",
    build: () =>
      make({
        key: { root: 7, scale: "mixolydian" },
        bpm: 124,
        degrees: [0, 6, 3, 0],
        style: "pulse",
        instruments: {
          chords: "organ",
          melody: "square_lead",
          bass: "finger_bass",
          drums: "kit_lm2",
        },
        drums: "rock",
        fill: true,
        crash: true,
        density: 0.65,
        seed: 7745,
        reverb: 0.15,
      }),
  },
]

/** A nearly empty song: one tonic chord, no melody. */
export function blankSong(previous: Song): Song {
  return {
    ...previous,
    chords: [{ id: uid(), degree: 0, type: "triad", inversion: 0, beats: 4 }],
    melody: [],
  }
}
