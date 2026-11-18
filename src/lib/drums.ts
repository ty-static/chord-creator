// Drum patterns: one bar of 16th-note steps, repeated across the song.
// A bar of 4/4 has 16 steps; other time signatures have more or fewer.

import { type Meter, type MeterId, drumSteps, meterOf } from "@/lib/meter"

export type DrumPiece =
  "kick" | "snare" | "clap" | "hat" | "openhat" | "tom" | "crash"

export const DRUM_PIECES: {
  id: DrumPiece
  label: string
  /** General MIDI drum note */ midi: number
}[] = [
  { id: "crash", label: "Crash", midi: 49 },
  { id: "openhat", label: "Open hat", midi: 46 },
  { id: "hat", label: "Closed hat", midi: 42 },
  { id: "tom", label: "Tom", midi: 45 },
  { id: "clap", label: "Clap", midi: 39 },
  { id: "snare", label: "Snare", midi: 38 },
  { id: "kick", label: "Kick", midi: 36 },
]

export const MIDI_TO_PIECE: Record<number, DrumPiece> = Object.fromEntries(
  DRUM_PIECES.map((p) => [p.midi, p.id])
) as Record<number, DrumPiece>

export const DRUM_STEPS = 16 // per bar of 4/4
export const DRUM_STEPS_PER_BEAT = 4

/** 0 = off, 1 = hit, 2 = accented hit */
export type StepValue = 0 | 1 | 2
export type DrumPattern = Record<DrumPiece, StepValue[]>

export type FillStyle = "snare" | "toms" | "roll" | "stop"

export const FILL_STYLES: { value: FillStyle; label: string; hint: string }[] =
  [
    { value: "snare", label: "Snare fill", hint: "Four rising snare hits" },
    {
      value: "toms",
      label: "Tom run",
      hint: "Snare and toms over the last two beats",
    },
    {
      value: "roll",
      label: "Snare roll",
      hint: "A snare roll that builds over the last two beats",
    },
    {
      value: "stop",
      label: "Drop out",
      hint: "The drums stop for the last beat",
    },
  ]

/** How many beats each fill takes at the end of a section. */
const FILL_BEATS: Record<FillStyle, number> = {
  snare: 1,
  toms: 2,
  roll: 2,
  stop: 1,
}

export interface DrumSettings {
  enabled: boolean
  pattern: DrumPattern
  /** A fill at the end of the section, every time it plays. */
  fill: boolean
  /** Which fill (a snare fill when unset). */
  fillStyle?: FillStyle
  /** Crash cymbal on the very first beat. */
  crashAtStart: boolean
}

/** Build a pattern from strings: "x" = accent, "o" = hit, anything else = rest. */
function pat(
  rows: Partial<Record<DrumPiece, string>>,
  length = DRUM_STEPS
): DrumPattern {
  const row = (s = "") =>
    Array.from({ length }, (_, i) =>
      s[i] === "x" ? 2 : s[i] === "o" ? 1 : 0
    ) as StepValue[]
  return {
    kick: row(rows.kick),
    snare: row(rows.snare),
    clap: row(rows.clap),
    hat: row(rows.hat),
    openhat: row(rows.openhat),
    tom: row(rows.tom),
    crash: row(rows.crash),
  }
}

export const DRUM_PRESETS: {
  id: string
  label: string
  pattern: DrumPattern
}[] = [
  {
    id: "pop",
    label: "Pop",
    pattern: pat({
      kick: "x-----o-x-o-----",
      snare: "----x-------x---",
      hat: "x-o-o-o-x-o-o-o-",
    }),
  },
  {
    id: "rock",
    label: "Rock",
    pattern: pat({
      kick: "x-------x-x-----",
      snare: "----x-------x---",
      hat: "x-o-x-o-x-o-x-o-",
    }),
  },
  {
    id: "four",
    label: "Four on the floor",
    pattern: pat({
      kick: "x---x---x---x---",
      clap: "----x-------x---",
      openhat: "--o---o---o---o-",
    }),
  },
  {
    id: "disco",
    label: "Disco",
    pattern: pat({
      kick: "x---x---x---x---",
      snare: "----x-------x---",
      hat: "o-o-o-o-o-o-o-o-",
      openhat: "--x---x---x---x-",
    }),
  },
  {
    id: "boombap",
    label: "Boom bap",
    pattern: pat({
      kick: "x-------o-x-----",
      snare: "----x-------x---",
      hat: "o-o-o-o-o-o-o-o-",
    }),
  },
  {
    id: "lofi",
    label: "Lo-fi",
    pattern: pat({
      kick: "x-----o---o-----",
      snare: "----x-------x---",
      hat: "o-o-o-o-o-o-oo-o",
    }),
  },
  {
    id: "halftime",
    label: "Half-time",
    pattern: pat({
      kick: "x-------------o-",
      snare: "--------x-------",
      hat: "o-o-o-o-o-o-o-o-",
      tom: "------------o-o-",
    }),
  },
  {
    id: "trap",
    label: "Trap",
    pattern: pat({
      kick: "x------o--x-----",
      snare: "--------x-------",
      hat: "o-o-oooo-o-o-ooo",
      openhat: "--------------o-",
    }),
  },
  {
    id: "onedrop",
    label: "Reggae one-drop",
    pattern: pat({
      kick: "--------x-------",
      snare: "--------o-------",
      hat: "--o---o---o---o-",
    }),
  },
]

/**
 * Fit a pattern to a bar of `length` steps: the start of the bar is kept and
 * the last beat lines up with the old last beat, so a 4/4 groove in 3/4
 * keeps its downbeat and its backbeat into the next bar.
 */
export function fitPattern(pattern: DrumPattern, length: number): DrumPattern {
  const from = pattern.kick.length
  if (from === length) return structuredClone(pattern)
  // Longer bars are built from a fitted 3/4 bar and the rest (5/4 = 3 + 2).
  if (length > from)
    return from > 12
      ? concat(fitPattern(pattern, 12), fitPattern(pattern, length - 12))
      : concat(structuredClone(pattern), fitPattern(pattern, length - from))
  const tail = Math.min(4, length)
  const out = {} as DrumPattern
  for (const { id } of DRUM_PIECES) {
    const row = pattern[id]
    out[id] = Array.from({ length }, (_, i) =>
      i < length - tail ? row[i] : row[from - (length - i)]
    )
  }
  return out
}

function concat(a: DrumPattern, b: DrumPattern): DrumPattern {
  const out = {} as DrumPattern
  for (const { id } of DRUM_PIECES) out[id] = [...a[id], ...b[id]]
  return out
}

// Grooves for the time signatures whose beats split into threes or that
// don't divide evenly; the others use the 4/4 presets, fitted to the bar.
const SIX_EIGHT: typeof DRUM_PRESETS = [
  {
    id: "pop",
    label: "Ballad",
    pattern: pat(
      {
        kick: "x-------o---",
        snare: "------x-----",
        hat: "x-o-o-x-o-o-",
      },
      12
    ),
  },
  {
    id: "rock",
    label: "Rock",
    pattern: pat(
      {
        kick: "x---o---o-o-",
        snare: "------x-----",
        hat: "x-o-o-x-o-o-",
      },
      12
    ),
  },
  {
    id: "four",
    label: "Kick on every beat",
    pattern: pat(
      {
        kick: "x-----x-----",
        clap: "------x-----",
        openhat: "--o-o---o-o-",
      },
      12
    ),
  },
  {
    id: "halftime",
    label: "Half-time",
    pattern: pat(
      {
        kick: "x-----------",
        snare: "------x-----",
        hat: "o---o-o---o-",
        tom: "--------o-o-",
      },
      12
    ),
  },
  {
    id: "jig",
    label: "Folk",
    pattern: pat(
      {
        kick: "x-----x-----",
        snare: "----o-----o-",
        hat: "--o-----o---",
      },
      12
    ),
  },
]

const SEVEN_EIGHT: typeof DRUM_PRESETS = [
  {
    id: "pop",
    label: "Pop (2 + 2 + 3)",
    pattern: pat(
      {
        kick: "x-------x-----",
        snare: "----x-------o-",
        hat: "x-o-x-o-x-o-o-",
      },
      14
    ),
  },
  {
    id: "rock",
    label: "Rock (2 + 2 + 3)",
    pattern: pat(
      {
        kick: "x---o---x-x---",
        snare: "----x-------x-",
        hat: "x-o-x-o-x-o-o-",
      },
      14
    ),
  },
  {
    id: "four",
    label: "Kick on every beat",
    pattern: pat(
      {
        kick: "x---x---x-----",
        clap: "----x-------x-",
        openhat: "--o---o---o---",
      },
      14
    ),
  },
]

/** 12/8 is two bars of 6/8 played as one. */
const TWELVE_EIGHT = SIX_EIGHT.map((p) => ({
  ...p,
  pattern: concat(p.pattern, p.pattern),
}))

/** The preset grooves for a time signature. */
export function drumPresets(meter: MeterId | Meter = "4/4") {
  const m = typeof meter === "string" ? meterOf(meter) : meter
  switch (m.id) {
    case "4/4":
      return DRUM_PRESETS
    case "6/8":
      return SIX_EIGHT
    case "12/8":
      return TWELVE_EIGHT
    case "7/8":
      return SEVEN_EIGHT
    default:
      return DRUM_PRESETS.map((p) => ({
        ...p,
        pattern: fitPattern(p.pattern, drumSteps(m)),
      }))
  }
}

export function presetPattern(id: string, meter?: MeterId): DrumPattern {
  const list = drumPresets(meter)
  const p = list.find((d) => d.id === id) ?? list[0]
  return structuredClone(p.pattern)
}

export function emptyPattern(meter?: MeterId): DrumPattern {
  return pat({}, drumSteps(meterOf(meter)))
}

/** A pattern moved to another time signature: the same preset if it has
 *  one there, otherwise the pattern fitted to the new bar. */
export function patternFor(pattern: DrumPattern, from: MeterId, to: MeterId) {
  const preset = matchingPreset(pattern, from)
  if (preset && drumPresets(to).some((p) => p.id === preset))
    return presetPattern(preset, to)
  return fitPattern(pattern, drumSteps(meterOf(to)))
}

export const DEFAULT_DRUMS: DrumSettings = {
  enabled: false,
  pattern: presetPattern("pop"),
  fill: false,
  crashAtStart: false,
}

/** Which preset (if any) the pattern currently matches. */
export function matchingPreset(pattern: DrumPattern, meter?: MeterId) {
  const key = JSON.stringify(pattern)
  return (
    drumPresets(meter).find((p) => JSON.stringify(p.pattern) === key)?.id ??
    null
  )
}

export interface DrumHit {
  midi: number
  /** Position in beats. */
  start: number
  velocity: number
}

const VELOCITY: Record<DrumPiece, [number, number]> = {
  kick: [100, 120],
  snare: [95, 118],
  clap: [90, 112],
  hat: [62, 88],
  openhat: [72, 92],
  tom: [88, 108],
  crash: [96, 112],
}

/** Expand the repeating pattern over a song of `totalBeats` beats. */
export function drumHits(
  settings: DrumSettings,
  totalBeats: number
): DrumHit[] {
  const hits: DrumHit[] = []
  const totalSteps = Math.round(totalBeats * DRUM_STEPS_PER_BEAT)
  const fillStyle = settings.fillStyle ?? "snare"
  const fillFrom = settings.fill
    ? Math.max(0, totalSteps - FILL_BEATS[fillStyle] * DRUM_STEPS_PER_BEAT)
    : Infinity
  const fillLength = totalSteps - fillFrom
  const midiOf = Object.fromEntries(
    DRUM_PIECES.map((p) => [p.id, p.midi])
  ) as Record<DrumPiece, number>

  const bar = settings.pattern.kick.length || DRUM_STEPS
  for (let step = 0; step < totalSteps; step++) {
    const s = step % bar
    const start = step / DRUM_STEPS_PER_BEAT
    if (step >= fillFrom) {
      fillHits(fillStyle, step - fillFrom, fillLength, start, midiOf, hits)
      continue
    }
    for (const piece of DRUM_PIECES) {
      const v = settings.pattern[piece.id][s]
      if (!v) continue
      // An open hat replaces a closed hat on the same step.
      if (piece.id === "hat" && settings.pattern.openhat[s]) continue
      hits.push({
        midi: piece.midi,
        start,
        velocity: VELOCITY[piece.id][v - 1],
      })
    }
  }
  if (settings.crashAtStart && totalSteps > 0 && !settings.pattern.crash[0])
    hits.push({ midi: midiOf.crash, start: 0, velocity: VELOCITY.crash[1] })
  return hits
}

const TOM_RUN = ["snare", "snare", "tom", "tom", "snare", "tom", "tom", "tom"]

/** The hits of step `n` of a fill `length` steps long. */
function fillHits(
  style: FillStyle,
  n: number,
  length: number,
  start: number,
  midiOf: Record<DrumPiece, number>,
  hits: DrumHit[]
) {
  const rise = (from: number, to: number) =>
    Math.min(
      127,
      Math.round(from + ((to - from) * n) / Math.max(1, length - 1))
    )
  switch (style) {
    case "stop":
      return
    case "toms": {
      const piece = TOM_RUN[n % TOM_RUN.length] as DrumPiece
      hits.push({ midi: midiOf[piece], start, velocity: rise(84, 118) })
      if (n % 4 === 0) hits.push({ midi: midiOf.kick, start, velocity: 104 })
      return
    }
    case "roll":
      hits.push({ midi: midiOf.snare, start, velocity: rise(52, 122) })
      if (n === 0) hits.push({ midi: midiOf.kick, start, velocity: 100 })
      return
    default:
      // Snare fill: 16ths building up, kick under the first one.
      hits.push({ midi: midiOf.snare, start, velocity: rise(78, 120) })
      if (n === 0) hits.push({ midi: midiOf.kick, start, velocity: 105 })
  }
}
