// Time signatures. Lengths everywhere in the app are counted in quarter-note
// "beats" (a bar of 6/8 is 3 beats, a bar of 7/8 is 3½); a meter adds how
// long a bar is and how its eighth notes group into felt beats.

export type MeterId = "4/4" | "3/4" | "2/4" | "5/4" | "6/8" | "7/8" | "12/8"

export interface Meter {
  id: MeterId
  num: number
  den: 4 | 8
  label: string
  hint: string
  /** Felt beats, in eighth notes: [2,2,2,2] for 4/4, [3,3] for 6/8, [2,2,3] for 7/8. */
  groups: number[]
  /** Chord lengths offered in the chord editor, in beats. */
  chordLengths: number[]
}

export const METERS: Meter[] = [
  {
    id: "4/4",
    num: 4,
    den: 4,
    label: "4/4",
    hint: "Four beats — most pop, rock and dance music",
    groups: [2, 2, 2, 2],
    chordLengths: [1, 2, 4, 8],
  },
  {
    id: "3/4",
    num: 3,
    den: 4,
    label: "3/4",
    hint: "Three beats — waltzes and many ballads",
    groups: [2, 2, 2],
    chordLengths: [1, 2, 3, 6],
  },
  {
    id: "2/4",
    num: 2,
    den: 4,
    label: "2/4",
    hint: "Two beats — marches and polkas",
    groups: [2, 2],
    chordLengths: [1, 2, 4],
  },
  {
    id: "5/4",
    num: 5,
    den: 4,
    label: "5/4",
    hint: "Five beats, felt as 3 + 2",
    groups: [2, 2, 2, 2, 2],
    chordLengths: [1, 2, 3, 5, 10],
  },
  {
    id: "6/8",
    num: 6,
    den: 8,
    label: "6/8",
    hint: "Two swaying beats of three — folk, ballads, slow rock",
    groups: [3, 3],
    chordLengths: [1.5, 3, 6],
  },
  {
    id: "7/8",
    num: 7,
    den: 8,
    label: "7/8",
    hint: "Seven eighths, felt as 2 + 2 + 3",
    groups: [2, 2, 3],
    chordLengths: [1, 2, 3.5, 7],
  },
  {
    id: "12/8",
    num: 12,
    den: 8,
    label: "12/8",
    hint: "Four beats of three — blues shuffles and soul ballads",
    groups: [3, 3, 3, 3],
    chordLengths: [1.5, 3, 6, 12],
  },
]

export const DEFAULT_METER: MeterId = "4/4"

export const meterOf = (id: MeterId | undefined): Meter =>
  METERS.find((m) => m.id === id) ?? METERS[0]

export const isMeterId = (x: unknown): x is MeterId =>
  METERS.some((m) => m.id === x)

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Length of a bar in beats (quarter notes). */
export const barBeats = (m: Meter) => sum(m.groups) / 2

/** Melody steps (eighth notes) in a bar. */
export const barSteps = (m: Meter) => sum(m.groups)

/** Drum steps (16th notes) in a bar. */
export const drumSteps = (m: Meter) => sum(m.groups) * 2

/** Compound meters (6/8, 12/8) feel each beat as three eighths. */
export const isCompound = (m: Meter) => m.groups.every((g) => g === 3)

/** Where the felt beats fall in a bar, in beats: [0,1,2,3] in 4/4, [0,1.5] in 6/8. */
export function pulses(m: Meter): number[] {
  const out: number[] = []
  let at = 0
  for (const g of m.groups) {
    out.push(at / 2)
    at += g
  }
  return out
}

/**
 * The strongest beats of a bar, where a bass alternating root and fifth
 * changes note: 1 and 3 in 4/4, 1 and 4 in 5/4 (3 + 2), every other beat
 * in 12/8, just the downbeat in 3/4 and 2/4.
 */
export function strongBeats(m: Meter): number[] {
  switch (m.id) {
    case "4/4":
      return [0, 2]
    case "5/4":
      return [0, 3]
    case "12/8":
      return [0, 3]
    case "6/8":
      return [0, 1.5]
    case "7/8":
      return [0, 2]
    default:
      return [0]
  }
}

/**
 * Beat positions (from the start of the section) of every felt beat in
 * [from, to), plus `from` itself — so a chord that starts off the beat
 * still sounds when it starts.
 */
export function beatsIn(m: Meter, from: number, to: number, which = pulses(m)) {
  const bar = barBeats(m)
  const out = new Set<number>([from])
  for (let b0 = Math.floor(from / bar) * bar; b0 < to; b0 += bar)
    for (const p of which) {
      const at = b0 + p
      if (at >= from && at < to) out.add(at)
    }
  return [...out].sort((a, b) => a - b)
}

/** Whether a beat position is the start of a bar. */
export const onBar = (m: Meter, beat: number) =>
  Math.abs(beat / barBeats(m) - Math.round(beat / barBeats(m))) < 1e-6

/** "1 bar", "2 bars", "½ bar" or "3 beats" for a chord length. */
export function lengthLabel(beats: number, m: Meter) {
  const bars = beats / barBeats(m)
  if (bars === 0.5) return "½ bar"
  if (Number.isInteger(bars)) return bars === 1 ? "1 bar" : `${bars} bars`
  return beats === 1 ? "1 beat" : `${beats} beats`
}

/** Bytes of a MIDI time-signature event (FF 58 04 …). */
export function midiTimeSig(m: Meter) {
  // MIDI clocks per metronome click: a quarter (24) or a dotted quarter (36).
  const click = isCompound(m) ? 36 : 24
  return [m.num, Math.log2(m.den), click, 8]
}

/** The meter of a MIDI file's time signature, if the app supports it. */
export function meterFromTimeSig([num, den]: [number, number]) {
  return METERS.find((m) => m.num === num && m.den === den)?.id ?? null
}
