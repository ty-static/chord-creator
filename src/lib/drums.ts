// Drum patterns: one bar of 16th-note steps, repeated across the song.

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

export const DRUM_STEPS = 16 // per bar
export const DRUM_STEPS_PER_BEAT = 4

/** 0 = off, 1 = hit, 2 = accented hit */
export type StepValue = 0 | 1 | 2
export type DrumPattern = Record<DrumPiece, StepValue[]>

export interface DrumSettings {
  enabled: boolean
  pattern: DrumPattern
  /** Snare fill on the last beat of the song. */
  fill: boolean
  /** Crash cymbal on the very first beat. */
  crashAtStart: boolean
}

/** Build a pattern from strings: "x" = accent, "o" = hit, anything else = rest. */
function pat(rows: Partial<Record<DrumPiece, string>>): DrumPattern {
  const row = (s = "") =>
    Array.from({ length: DRUM_STEPS }, (_, i) =>
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

export function presetPattern(id: string): DrumPattern {
  const p = DRUM_PRESETS.find((d) => d.id === id) ?? DRUM_PRESETS[0]
  return structuredClone(p.pattern)
}

export function emptyPattern(): DrumPattern {
  return pat({})
}

export const DEFAULT_DRUMS: DrumSettings = {
  enabled: false,
  pattern: presetPattern("pop"),
  fill: false,
  crashAtStart: false,
}

/** Which preset (if any) the pattern currently matches. */
export function matchingPreset(pattern: DrumPattern) {
  const key = JSON.stringify(pattern)
  return DRUM_PRESETS.find((p) => JSON.stringify(p.pattern) === key)?.id ?? null
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
  const fillFrom = settings.fill
    ? Math.max(0, totalSteps - DRUM_STEPS_PER_BEAT)
    : Infinity
  const midiOf = Object.fromEntries(
    DRUM_PIECES.map((p) => [p.id, p.midi])
  ) as Record<DrumPiece, number>

  for (let step = 0; step < totalSteps; step++) {
    const s = step % DRUM_STEPS
    const start = step / DRUM_STEPS_PER_BEAT
    if (step >= fillFrom) {
      // Snare fill: four 16ths building up, kick under the first one.
      const n = step - fillFrom
      hits.push({ midi: midiOf.snare, start, velocity: 78 + n * 14 })
      if (n === 0) hits.push({ midi: midiOf.kick, start, velocity: 105 })
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
