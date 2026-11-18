import type { ChordStyle, Section, Song } from "@/lib/arrange"
import { DEFAULT_MIX } from "@/lib/audio-engine"
import { DEFAULT_DRUMS, type DrumSettings, presetPattern } from "@/lib/drums"
import { makeSection } from "@/lib/sections"
import { type MeterId, barBeats, barSteps, meterOf } from "@/lib/meter"
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

/** One section of a song: its chords, melody and beat. */
interface PartSpec {
  name: string
  degrees: number[]
  type?: ChordType | ChordType[]
  beats?: number
  density: number
  seed: number
  /** Drum preset id; omit for no drums. */
  drums?: string
  fill?: boolean
  crash?: boolean
}

interface Spec {
  key: Key
  bpm: number
  /** Time signature (4/4 when unset); chord lengths are in bars of it. */
  meter?: MeterId
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
  /** Name of the first section (default "Verse"). */
  name?: string
  /** More sections after the first one (B, C…). */
  more?: PartSpec[]
  /** The form as section indexes (default: each section once). */
  form?: number[]
}

function drumsOf(p: PartSpec, meter?: MeterId): DrumSettings {
  return p.drums
    ? {
        enabled: true,
        pattern: presetPattern(p.drums, meter),
        fill: p.fill ?? false,
        crashAtStart: p.crash ?? false,
      }
    : { ...DEFAULT_DRUMS, enabled: false }
}

function makePart(p: PartSpec, meter?: MeterId): Section {
  const m = meterOf(meter)
  const chords: Chord[] = p.degrees.map((degree, i) => ({
    id: uid(),
    degree,
    type: Array.isArray(p.type)
      ? p.type[i % p.type.length]
      : (p.type ?? "triad"),
    inversion: 0,
    // `beats` are given as in 4/4 and scaled to the bar (a bar of 6/8 is 3).
    beats: ((p.beats ?? 4) * barBeats(m)) / 4,
  }))
  const melody = generateMelody(chords, {
    density: p.density,
    seed: p.seed,
    barSteps: barSteps(m),
  })
  return makeSection(p.name, chords, melody, drumsOf(p, meter))
}

function make(spec: Spec): Song {
  const parts = [{ ...spec, name: spec.name ?? "Verse" }, ...(spec.more ?? [])]
  const sections = parts.map((p) =>
    makePart({ ...p, type: p.type ?? spec.type }, spec.meter)
  )
  const form = spec.form ?? sections.map((_, i) => i)
  return {
    title: "",
    key: spec.key,
    bpm: spec.bpm,
    ...(spec.meter ? { meter: spec.meter } : {}),
    sections,
    arrangement: form.map((i) => ({ id: uid(), section: sections[i].id })),
    chordStyle: spec.style,
    bass: spec.bass ?? true,
    instruments: spec.instruments,
    reverb: spec.reverb ?? 0.25,
    mix: structuredClone(DEFAULT_MIX),
    voiceLeading: spec.voiceLeading ?? true,
  }
}

const RAW_EXAMPLES: Example[] = [
  {
    id: "pop",
    label: "Pop Anthem",
    description: "C major · verse, chorus & bridge · 112 BPM",
    build: () =>
      make({
        key: { root: 0, scale: "major" },
        bpm: 112,
        name: "Verse",
        degrees: [5, 3, 0, 4],
        style: "pulse",
        instruments: {
          chords: "grand_piano",
          melody: "electric_piano",
          bass: "finger_bass",
          drums: "kit_lm2",
        },
        drums: "pop",
        density: 0.45,
        seed: 1201,
        more: [
          {
            name: "Chorus",
            degrees: [0, 4, 5, 3],
            drums: "pop",
            crash: true,
            fill: true,
            density: 0.7,
            seed: 1207,
          },
          {
            name: "Bridge",
            degrees: [1, 4, 2, 5],
            drums: "halftime",
            fill: true,
            density: 0.5,
            seed: 1213,
          },
        ],
        form: [0, 1, 0, 1, 2, 1],
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
  {
    id: "folk",
    label: "Folk Ballad in 6/8",
    description: "D major · verse & chorus in 6/8 · 96 BPM",
    build: () =>
      make({
        key: { root: 2, scale: "major" },
        bpm: 96,
        meter: "6/8",
        degrees: [0, 5, 3, 4],
        style: "arpeggio",
        instruments: {
          chords: "nylon_guitar",
          melody: "flute",
          bass: "acoustic_bass",
          drums: "kit_cr8000",
        },
        drums: "pop",
        density: 0.5,
        seed: 6081,
        reverb: 0.35,
        more: [
          {
            name: "Chorus",
            degrees: [3, 0, 3, 4],
            drums: "rock",
            fill: true,
            density: 0.6,
            seed: 6082,
          },
        ],
        form: [0, 1, 0, 1],
      }),
  },
]

/** Example songs, each titled with its label. */
export const EXAMPLES: Example[] = RAW_EXAMPLES.map((ex) => ({
  ...ex,
  build: () => ({ ...ex.build(), title: ex.label }),
}))

/** A nearly empty song: one section with a tonic chord and no melody. */
export function blankSong(previous: Song): Song {
  const section = makeSection(
    "Verse",
    [
      {
        id: uid(),
        degree: 0,
        type: "triad",
        inversion: 0,
        beats: barBeats(meterOf(previous.meter)),
      },
    ],
    [],
    structuredClone(previous.sections[0]?.drums ?? DEFAULT_DRUMS)
  )
  return {
    ...previous,
    title: "Untitled song",
    sections: [section],
    arrangement: [{ id: uid(), section: section.id }],
  }
}
