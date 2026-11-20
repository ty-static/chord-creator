// Styles for making an arrangement of a tune: each sets the drum groove,
// how the chords and bass are played, the instruments and the feel.

import type { Song } from "@/lib/arrange"
import type { BassStyle } from "@/lib/bass"
import { DEFAULT_DRUMS, type DrumSettings, presetPattern } from "@/lib/drums"
import type { TrackInstruments } from "@/lib/instruments"
import type { MeterId } from "@/lib/meter"
import type { ChordStyle } from "@/lib/rhythm"

export type ArrangeStyleId =
  "pop" | "rock" | "ballad" | "dance" | "lofi" | "reggae" | "plain"

export interface ArrangeStyle {
  id: ArrangeStyleId
  label: string
  /** What you'll hear, in a few words. */
  hint: string
  /** Drum preset, or null for no drums. */
  drums: string | null
  chordStyle: ChordStyle
  /** Bass pattern, or null for no bass. */
  bass: BassStyle | null
  instruments: Omit<TrackInstruments, "melody">
  swing?: number
}

export const ARRANGE_STYLES: ArrangeStyle[] = [
  {
    id: "pop",
    label: "Pop",
    hint: "Piano on every beat, a syncopated bass and a pop beat",
    drums: "pop",
    chordStyle: "pulse",
    bass: "pop",
    instruments: {
      chords: "grand_piano",
      bass: "finger_bass",
      drums: "kit_lm2",
    },
  },
  {
    id: "rock",
    label: "Rock",
    hint: "Strummed chords, bass locked to the kick and a rock beat",
    drums: "rock",
    chordStyle: "strum",
    bass: "kick",
    instruments: { chords: "organ", bass: "finger_bass", drums: "kit_cr8000" },
  },
  {
    id: "ballad",
    label: "Ballad",
    hint: "Arpeggiated piano, long bass notes and a half-time beat",
    drums: "halftime",
    chordStyle: "arpeggio",
    bass: "root",
    instruments: {
      chords: "grand_piano",
      bass: "fretless_bass",
      drums: "kit_lm2",
    },
  },
  {
    id: "dance",
    label: "Dance",
    hint: "Pad chords, octave bass and four on the floor",
    drums: "four",
    chordStyle: "pulse",
    bass: "octaves",
    instruments: { chords: "warm_pad", bass: "synth_bass", drums: "kit_mfb" },
  },
  {
    id: "lofi",
    label: "Lo-fi",
    hint: "Held electric piano, a lazy swung beat and soft bass",
    drums: "lofi",
    chordStyle: "block",
    bass: "root",
    instruments: {
      chords: "electric_piano",
      bass: "acoustic_bass",
      drums: "kit_rz1",
    },
    swing: 0.4,
  },
  {
    id: "reggae",
    label: "Reggae",
    hint: "Organ skanks between the beats over a one-drop",
    drums: "onedrop",
    chordStyle: "offbeat",
    bass: "root",
    instruments: { chords: "organ", bass: "finger_bass", drums: "kit_808" },
  },
  {
    id: "plain",
    label: "Just chords",
    hint: "Held piano chords under the tune, no bass or drums",
    drums: null,
    chordStyle: "block",
    bass: null,
    instruments: {
      chords: "grand_piano",
      bass: "finger_bass",
      drums: "kit_lm2",
    },
  },
]

export const DEFAULT_ARRANGE_STYLE: ArrangeStyleId = "pop"

export const arrangeStyle = (id: string | null | undefined) =>
  ARRANGE_STYLES.find((s) => s.id === id) ??
  ARRANGE_STYLES.find((s) => s.id === DEFAULT_ARRANGE_STYLE)!

/** The style's drums for a section (off for a style without drums). */
export function styleDrums(style: ArrangeStyle, meter?: MeterId): DrumSettings {
  return {
    ...DEFAULT_DRUMS,
    enabled: !!style.drums,
    pattern: presetPattern(style.drums ?? "pop", meter),
  }
}

/** A song played in the style: chords, bass, instruments and feel. */
export function applyStyle(song: Song, style: ArrangeStyle): Song {
  const out: Song = {
    ...song,
    chordStyle: style.chordStyle,
    bass: !!style.bass,
    instruments: { ...song.instruments, ...style.instruments },
  }
  // Unset means straight and roots, as everywhere else.
  if (style.swing) out.swing = style.swing
  else delete out.swing
  if (style.bass && style.bass !== "root") out.bassStyle = style.bass
  else delete out.bassStyle
  return out
}
