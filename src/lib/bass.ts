// Bass line patterns: from one root note per chord to a walking line.

import { type Chord, type Key, chordMidi } from "@/lib/music"

export type BassStyle =
  "root" | "fifths" | "octaves" | "walking" | "pop" | "kick"

export const BASS_STYLES: { value: BassStyle; label: string; hint: string }[] =
  [
    { value: "root", label: "Roots", hint: "One long root note per chord" },
    {
      value: "fifths",
      label: "Root–fifth",
      hint: "Root and fifth on alternate half notes, as in country and folk",
    },
    {
      value: "octaves",
      label: "Octaves",
      hint: "Eighth notes jumping between octaves, as in disco and dance",
    },
    {
      value: "walking",
      label: "Walking",
      hint: "A note every beat, stepping into the next chord, as in jazz",
    },
    {
      value: "pop",
      label: "Syncopated",
      hint: "A pushed eighth-note groove, as in pop and funk",
    },
    {
      value: "kick",
      label: "Follow the kick",
      hint: "Plays the root with every kick drum hit",
    },
  ]

export const bassLabel = (style: BassStyle = "root") =>
  BASS_STYLES.find((b) => b.value === style)?.label ?? "Roots"
export const bassHint = (style: BassStyle = "root") =>
  BASS_STYLES.find((b) => b.value === style)?.hint ?? ""

export interface BassNote {
  midi: number
  start: number // beats from the start of the section
  duration: number // beats
  velocity: number
}

/** A chord's root, third and fifth in the bass register. */
function tones(chord: Chord, key: Key) {
  const notes = chordMidi({ ...chord, inversion: 0 }, key).map((m) => m - 12)
  const root = notes[0]
  return { root, third: notes[1] ?? root + 4, fifth: notes[2] ?? root + 7 }
}

/**
 * The bass line for a section's chords. `kicks` are the kick drum times in
 * beats, used by the "kick" style. The line wraps: the last chord walks
 * back into the first, as the section loops or repeats.
 */
export function bassLine(
  chords: Chord[],
  key: Key,
  style: BassStyle,
  kicks: number[] = []
): BassNote[] {
  const out: BassNote[] = []
  const note = (
    midi: number,
    start: number,
    duration: number,
    velocity: number
  ) => out.push({ midi, start, duration, velocity })
  let t = 0
  chords.forEach((chord, i) => {
    const { root, third, fifth } = tones(chord, key)
    const beats = chord.beats
    const whole = () => note(root, t, beats * 0.98, 90)

    switch (style) {
      case "fifths":
        for (let b = 0; b < beats; b += 2)
          note(
            (b / 2) % 2 === 0 ? root : fifth,
            t + b,
            Math.min(2, beats - b) * 0.95,
            b === 0 ? 92 : 84
          )
        break

      case "octaves":
        for (let s = 0; s < beats * 2; s++)
          note(s % 2 ? root + 12 : root, t + s / 2, 0.45, s % 2 ? 76 : 92)
        break

      case "walking": {
        // Step into the next root (where it is actually played) from a
        // semitone away, or from the fifth when the chord repeats.
        const next = tones(chords[(i + 1) % chords.length], key).root
        const approach =
          next === root ? fifth : next > root ? next - 1 : next + 1
        const middle = [third, fifth, root + 12]
        for (let b = 0; b < beats; b++) {
          const midi =
            b === 0
              ? root
              : b === beats - 1
                ? approach
                : middle[(b - 1) % middle.length]
          note(midi, t + b, 0.9, b === 0 ? 92 : 80)
        }
        break
      }

      case "pop": {
        // One bar of groove, repeated and cut to the chord's length.
        const bar: [number, number, number, number][] = [
          [0, 1.4, root, 96],
          [1.5, 0.45, root, 78],
          [2.5, 0.45, root, 84],
          [3, 0.45, fifth, 80],
          [3.5, 0.45, root + 12, 82],
        ]
        for (let w = 0; w < beats; w += 4)
          for (const [at, len, midi, vel] of bar)
            if (w + at < beats)
              note(midi, t + w + at, Math.min(len, beats - w - at), vel)
        break
      }

      case "kick": {
        const hits = kicks.filter((k) => k >= t && k < t + beats)
        if (!hits.length) {
          whole()
          break
        }
        // Hold the root from the chord change until the first kick.
        if (hits[0] > t) note(root, t, (hits[0] - t) * 0.95, 84)
        hits.forEach((k, j) => {
          const end = hits[j + 1] ?? t + beats
          note(root, k, (end - k) * 0.95, 94)
        })
        break
      }

      default:
        whole()
    }
    t += beats
  })
  return out
}
