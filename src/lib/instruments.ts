import type { TrackName } from "@/lib/arrange"
import type { DrumPiece } from "@/lib/drums"

export type InstrumentSource =
  | { kind: "piano" } // smplr SplendidGrandPiano (multi-sampled Steinway)
  | { kind: "soundfont"; name: string } // General MIDI soundfont (MusyngKite)
  | { kind: "synth" } // built-in oscillator, no download
  | { kind: "drums"; machine: string; map: Record<DrumPiece, string> } // smplr DrumMachine

export interface InstrumentDef {
  id: string
  label: string
  /** General MIDI program number written to exported .mid files. */
  program: number
  source: InstrumentSource
}

const sf = (name: string): InstrumentSource => ({ kind: "soundfont", name })

export const INSTRUMENTS: Record<string, InstrumentDef> = {
  grand_piano: {
    id: "grand_piano",
    label: "Grand Piano",
    program: 0,
    source: { kind: "piano" },
  },
  electric_piano: {
    id: "electric_piano",
    label: "Electric Piano",
    program: 4,
    source: sf("electric_piano_1"),
  },
  warm_pad: {
    id: "warm_pad",
    label: "Warm Pad",
    program: 89,
    source: sf("pad_2_warm"),
  },
  new_age_pad: {
    id: "new_age_pad",
    label: "Shimmer Pad",
    program: 88,
    source: sf("pad_1_new_age"),
  },
  strings: {
    id: "strings",
    label: "Strings",
    program: 48,
    source: sf("string_ensemble_1"),
  },
  organ: {
    id: "organ",
    label: "Organ",
    program: 16,
    source: sf("drawbar_organ"),
  },
  choir: { id: "choir", label: "Choir", program: 52, source: sf("choir_aahs") },
  nylon_guitar: {
    id: "nylon_guitar",
    label: "Nylon Guitar",
    program: 24,
    source: sf("acoustic_guitar_nylon"),
  },
  vibraphone: {
    id: "vibraphone",
    label: "Vibraphone",
    program: 11,
    source: sf("vibraphone"),
  },
  marimba: {
    id: "marimba",
    label: "Marimba",
    program: 12,
    source: sf("marimba"),
  },
  flute: { id: "flute", label: "Flute", program: 73, source: sf("flute") },
  square_lead: {
    id: "square_lead",
    label: "Square Lead",
    program: 80,
    source: sf("lead_1_square"),
  },
  saw_lead: {
    id: "saw_lead",
    label: "Saw Lead",
    program: 81,
    source: sf("lead_2_sawtooth"),
  },
  finger_bass: {
    id: "finger_bass",
    label: "Finger Bass",
    program: 33,
    source: sf("electric_bass_finger"),
  },
  acoustic_bass: {
    id: "acoustic_bass",
    label: "Upright Bass",
    program: 32,
    source: sf("acoustic_bass"),
  },
  fretless_bass: {
    id: "fretless_bass",
    label: "Fretless Bass",
    program: 35,
    source: sf("fretless_bass"),
  },
  synth_bass: {
    id: "synth_bass",
    label: "Synth Bass",
    program: 38,
    source: sf("synth_bass_1"),
  },
  kit_lm2: {
    id: "kit_lm2",
    label: "LM-2 (80s pop)",
    program: 0,
    source: {
      kind: "drums",
      machine: "LM-2",
      map: {
        kick: "kick",
        snare: "snare-m",
        clap: "clap",
        hat: "hhclosed",
        openhat: "hhopen",
        tom: "tom-m",
        crash: "crash",
      },
    },
  },
  kit_808: {
    id: "kit_808",
    label: "TR-808 (hip-hop)",
    program: 0,
    source: {
      kind: "drums",
      machine: "TR-808",
      map: {
        kick: "kick",
        snare: "snare",
        clap: "clap",
        hat: "hihat-close",
        openhat: "hihat-open",
        tom: "mid-tom",
        crash: "cymbal",
      },
    },
  },
  kit_rz1: {
    id: "kit_rz1",
    label: "Casio RZ-1 (lo-fi)",
    program: 0,
    source: {
      kind: "drums",
      machine: "Casio-RZ1",
      map: {
        kick: "kick",
        snare: "snare",
        clap: "clap",
        hat: "hihat-closed",
        openhat: "hihat-open",
        tom: "tom-2",
        crash: "crash",
      },
    },
  },
  kit_cr8000: {
    id: "kit_cr8000",
    label: "CR-8000 (vintage)",
    program: 0,
    source: {
      kind: "drums",
      machine: "Roland CR-8000",
      map: {
        kick: "kick",
        snare: "snare",
        clap: "clap",
        hat: "hihat-closed",
        openhat: "hihat-open",
        tom: "tom-low",
        crash: "cymball",
      },
    },
  },
  kit_mfb: {
    id: "kit_mfb",
    label: "MFB-512 (electro)",
    program: 0,
    source: {
      kind: "drums",
      machine: "MFB-512",
      map: {
        kick: "kick",
        snare: "snare",
        clap: "clap",
        hat: "hihat-closed",
        openhat: "hihat-open",
        tom: "tom-mid",
        crash: "cymbal",
      },
    },
  },
  basic_synth: {
    id: "basic_synth",
    label: "Basic Synth (offline)",
    program: 81,
    source: { kind: "synth" },
  },
}

export const TRACK_INSTRUMENTS: Record<TrackName, string[]> = {
  chords: [
    "grand_piano",
    "electric_piano",
    "warm_pad",
    "new_age_pad",
    "strings",
    "organ",
    "choir",
    "nylon_guitar",
    "basic_synth",
  ],
  melody: [
    "grand_piano",
    "electric_piano",
    "vibraphone",
    "marimba",
    "flute",
    "strings",
    "square_lead",
    "saw_lead",
    "basic_synth",
  ],
  bass: [
    "finger_bass",
    "acoustic_bass",
    "fretless_bass",
    "synth_bass",
    "basic_synth",
  ],
  drums: [
    "kit_lm2",
    "kit_808",
    "kit_rz1",
    "kit_cr8000",
    "kit_mfb",
    "basic_synth",
  ],
}

export type TrackInstruments = Record<TrackName, string>

export const DEFAULT_INSTRUMENTS: TrackInstruments = {
  chords: "grand_piano",
  melody: "electric_piano",
  bass: "finger_bass",
  drums: "kit_lm2",
}

/** Note range each track can use — limits how many samples get decoded. */
export const TRACK_RANGE: Record<TrackName, [number, number]> = {
  chords: [36, 88],
  melody: [48, 96],
  bass: [24, 60],
  drums: [35, 81],
}
