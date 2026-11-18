// How the chord track plays each chord: held, on every beat, broken up, or
// in a rhythm pattern (strums, off-beat skanks, a Charleston, oom-pah).
// Patterns are laid out on the bar of the song's time signature.

import {
  type Meter,
  barBeats,
  beatsIn,
  isCompound,
  pulses,
  strongBeats,
} from "@/lib/meter"

export type ChordStyle =
  "block" | "pulse" | "arpeggio" | "strum" | "offbeat" | "charleston" | "oompah"

export const CHORD_STYLES: {
  value: ChordStyle
  label: string
  hint: string
}[] = [
  { value: "block", label: "Block", hint: "Each chord held for its length" },
  { value: "pulse", label: "Pulse", hint: "The chord on every beat" },
  {
    value: "arpeggio",
    label: "Arpeggio",
    hint: "The chord's notes one at a time, up and down",
  },
  {
    value: "strum",
    label: "Strum",
    hint: "Down and up strums like a guitar (down, down-up, up-down-up)",
  },
  {
    value: "offbeat",
    label: "Off-beat",
    hint: "Short chords between the beats, as in reggae and ska",
  },
  {
    value: "charleston",
    label: "Charleston",
    hint: "A hit on beat 1 and a pushed one just after beat 2, as in swing and jazz",
  },
  {
    value: "oompah",
    label: "Oom-pah",
    hint: "The low note on the strong beats, the rest of the chord between — a waltz in 3/4",
  },
]

export const isChordStyle = (x: unknown): x is ChordStyle =>
  CHORD_STYLES.some((s) => s.value === x)

export const chordStyleLabel = (style: ChordStyle) =>
  CHORD_STYLES.find((s) => s.value === style)?.label ?? "Block"
export const chordStyleHint = (style: ChordStyle) =>
  CHORD_STYLES.find((s) => s.value === style)?.hint ?? ""

export interface ChordHit {
  midi: number
  start: number // beats
  duration: number // beats
  velocity: number
}

/**
 * What a hit plays: the whole chord at once, strummed down (low to high) or
 * up (the top notes, high to low), just the lowest note, or all but it.
 */
type Kind = "full" | "down" | "up" | "low" | "high"

interface Step {
  /** Beats from the start of the bar. */
  at: number
  kind: Kind
  velocity: number
  /** At most this long (staccato); otherwise until the next hit. */
  max?: number
}

/** Beats between the notes of a strum (about 12 ms at 100 BPM). */
export const STRUM_GAP = 0.02

/** The steps of one bar of a pattern, in a time signature. */
function barPattern(style: ChordStyle, m: Meter): Step[] {
  const p = pulses(m)
  // Each felt beat with the eighth notes in it.
  const groups = m.groups.map((size, i) => ({ start: p[i], size }))
  switch (style) {
    case "strum":
      if (m.id === "4/4")
        return [
          { at: 0, kind: "down", velocity: 84 },
          { at: 1, kind: "down", velocity: 78 },
          { at: 1.5, kind: "up", velocity: 64 },
          { at: 2.5, kind: "up", velocity: 66 },
          { at: 3, kind: "down", velocity: 78 },
          { at: 3.5, kind: "up", velocity: 62 },
        ]
      return groups.flatMap((g, i) => [
        { at: g.start, kind: "down", velocity: i === 0 ? 84 : 76 },
        ...Array.from({ length: g.size - 1 }, (_, k) => ({
          at: g.start + (k + 1) / 2,
          kind: "up" as const,
          velocity: 62,
        })),
      ])

    case "offbeat":
      // Every eighth but the first of each beat, short.
      return groups.flatMap((g) =>
        Array.from({ length: g.size - 1 }, (_, k) => ({
          at: g.start + (k + 1) / 2,
          kind: "full" as const,
          velocity: k === 0 ? 74 : 66,
          max: 0.3,
        }))
      )

    case "charleston":
      if (isCompound(m))
        // Each pair of beats: a hit, then one pushed an eighth before the next beat.
        return p.flatMap((at, i) =>
          i % 2 === 0
            ? [
                { at, kind: "full" as const, velocity: 86 },
                ...(p[i + 1] !== undefined
                  ? [
                      {
                        at: p[i + 1] - 0.5,
                        kind: "full" as const,
                        velocity: 76,
                        max: 0.4,
                      },
                    ]
                  : []),
              ]
            : []
        )
      return [
        { at: 0, kind: "full", velocity: 86 },
        ...((p[1] ?? 0) + 0.5 < barBeats(m)
          ? [
              {
                at: (p[1] ?? 0) + 0.5,
                kind: "full" as const,
                velocity: 76,
                max: 0.4,
              },
            ]
          : []),
      ]

    case "oompah":
      if (isCompound(m))
        // Oom-pa-pa in each beat of three eighths.
        return groups.flatMap((g) => [
          { at: g.start, kind: "low" as const, velocity: 84 },
          ...Array.from({ length: g.size - 1 }, (_, k) => ({
            at: g.start + (k + 1) / 2,
            kind: "high" as const,
            velocity: 64,
            max: 0.4,
          })),
        ])
      return p.map((at) =>
        strongBeats(m).includes(at)
          ? { at, kind: "low" as const, velocity: 84 }
          : { at, kind: "high" as const, velocity: 68, max: 0.6 }
      )

    default:
      return []
  }
}

/**
 * The chord track's notes for one chord: `notes` (its voicing, low to high)
 * from beat `from` (of the section) for `beats` beats.
 */
export function chordHits(
  style: ChordStyle,
  notes: number[],
  from: number,
  beats: number,
  m: Meter
): ChordHit[] {
  const out: ChordHit[] = []
  const end = from + beats
  if (!notes.length || beats <= 0) return out

  if (style === "block") {
    for (const midi of notes)
      out.push({ midi, start: from, duration: beats * 0.98, velocity: 76 })
    return out
  }

  if (style === "pulse") {
    // On every felt beat: quarters in 4/4, dotted quarters in 6/8.
    const hits = beatsIn(m, from, end)
    hits.forEach((at, i) => {
      const gap = (hits[i + 1] ?? end) - at
      for (const midi of notes)
        out.push({
          midi,
          start: at,
          duration: gap * 0.85,
          velocity: i % 2 === 0 ? 80 : 66,
        })
    })
    return out
  }

  if (style === "arpeggio") {
    const pattern = [...notes, ...notes.slice(1, -1).reverse()]
    const steps = beats * 2
    for (let s = 0; s < steps; s++)
      out.push({
        midi: pattern[s % pattern.length],
        start: from + s / 2,
        duration: 0.48,
        velocity: s % 2 === 0 ? 78 : 64,
      })
    return out
  }

  // A rhythm pattern: its steps in every bar the chord covers.
  const low = [...notes].sort((a, b) => a - b)
  const bar = barBeats(m)
  const steps = barPattern(style, m)
  const placed: Step[] = []
  for (let b0 = Math.floor(from / bar) * bar; b0 < end; b0 += bar)
    for (const s of steps) {
      const at = b0 + s.at
      if (at >= from - 1e-9 && at < end - 1e-9) placed.push({ ...s, at })
    }
  // A chord that starts between hits still sounds when it starts (unless
  // the pattern plays within an eighth of it, like an off-beat skank).
  if (!placed.some((s) => s.at - from < 0.5 + 1e-9))
    placed.unshift({
      at: from,
      kind: steps[0]?.kind === "low" ? "low" : "full",
      velocity: 80,
    })
  placed.sort((a, b) => a.at - b.at)

  placed.forEach((s, i) => {
    const gap = (placed[i + 1]?.at ?? end) - s.at
    const duration = Math.min(gap * 0.9, s.max ?? Infinity)
    const play = (midi: number, offset = 0, velocity = s.velocity) =>
      out.push({
        midi,
        start: s.at + offset,
        duration: Math.max(0.05, duration - offset),
        velocity,
      })
    switch (s.kind) {
      case "down":
        low.forEach((midi, j) => play(midi, j * STRUM_GAP))
        break
      case "up":
        // The top of the chord, highest first, a little softer.
        low
          .slice(-3)
          .reverse()
          .forEach((midi, j) => play(midi, j * STRUM_GAP))
        break
      case "low":
        play(low[0])
        break
      case "high":
        for (const midi of low.length > 1 ? low.slice(1) : low) play(midi)
        break
      default:
        for (const midi of notes) play(midi)
    }
  })
  return out
}
