// Music theory helpers for Chord Creator.
// Chords and melody notes are stored as scale-degree indices, so changing the
// key or scale re-maps everything automatically.

export const ROOTS = [
  { value: 0, label: "C" },
  { value: 1, label: "D♭" },
  { value: 2, label: "D" },
  { value: 3, label: "E♭" },
  { value: 4, label: "E" },
  { value: 5, label: "F" },
  { value: 6, label: "F♯" },
  { value: 7, label: "G" },
  { value: 8, label: "A♭" },
  { value: 9, label: "A" },
  { value: 10, label: "B♭" },
  { value: 11, label: "B" },
] as const

export type ScaleId =
  | "major"
  | "minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "harmonicMinor"
  | "melodicMinor"

export const SCALES: Record<
  ScaleId,
  { label: string; intervals: number[]; parentOffset: number; minor: boolean }
> = {
  major: {
    label: "Major",
    intervals: [0, 2, 4, 5, 7, 9, 11],
    parentOffset: 0,
    minor: false,
  },
  minor: {
    label: "Natural Minor",
    intervals: [0, 2, 3, 5, 7, 8, 10],
    parentOffset: 9,
    minor: true,
  },
  dorian: {
    label: "Dorian",
    intervals: [0, 2, 3, 5, 7, 9, 10],
    parentOffset: 2,
    minor: true,
  },
  phrygian: {
    label: "Phrygian",
    intervals: [0, 1, 3, 5, 7, 8, 10],
    parentOffset: 4,
    minor: true,
  },
  lydian: {
    label: "Lydian",
    intervals: [0, 2, 4, 6, 7, 9, 11],
    parentOffset: 5,
    minor: false,
  },
  mixolydian: {
    label: "Mixolydian",
    intervals: [0, 2, 4, 5, 7, 9, 10],
    parentOffset: 7,
    minor: false,
  },
  locrian: {
    label: "Locrian",
    intervals: [0, 1, 3, 5, 6, 8, 10],
    parentOffset: 11,
    minor: true,
  },
  harmonicMinor: {
    label: "Harmonic Minor",
    intervals: [0, 2, 3, 5, 7, 8, 11],
    parentOffset: 9,
    minor: true,
  },
  melodicMinor: {
    label: "Melodic Minor",
    intervals: [0, 2, 3, 5, 7, 9, 11],
    parentOffset: 9,
    minor: true,
  },
}

export interface Key {
  root: number
  scale: ScaleId
}

const SHARP_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
]
const FLAT_NAMES = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "G♭",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
]
// Sharps(+)/flats(-) in the key signature of each major key.
const MAJOR_KEY_SIG: Record<number, number> = {
  0: 0,
  7: 1,
  2: 2,
  9: 3,
  4: 4,
  11: 5,
  6: 6,
  1: -5,
  8: -4,
  3: -3,
  10: -2,
  5: -1,
}

function parentMajor(key: Key) {
  return (key.root - SCALES[key.scale].parentOffset + 12) % 12
}

export function keySignature(key: Key) {
  return { sf: MAJOR_KEY_SIG[parentMajor(key)], minor: SCALES[key.scale].minor }
}

export function noteName(midi: number, key: Key) {
  const names = keySignature(key).sf < 0 ? FLAT_NAMES : SHARP_NAMES
  return names[((midi % 12) + 12) % 12]
}

export function noteNameWithOctave(midi: number, key: Key) {
  return `${noteName(midi, key)}${Math.floor(midi / 12) - 1}`
}

export function keyLabel(key: Key) {
  return `${noteName(key.root, key)} ${SCALES[key.scale].label}`
}

/** MIDI note of the key's tonic used as degree 0 for chords (around C3). */
export function chordBase(key: Key) {
  return 48 + key.root - (key.root >= 7 ? 12 : 0)
}

/** MIDI note of the key's tonic used as degree 0 for the melody (around C4). */
export function melodyBase(key: Key) {
  return chordBase(key) + 12
}

export function degreeToMidi(degree: number, key: Key, base: number) {
  const intervals = SCALES[key.scale].intervals
  const oct = Math.floor(degree / 7)
  const idx = ((degree % 7) + 7) % 7
  return base + intervals[idx] + oct * 12
}

export function scaleNotes(key: Key) {
  return SCALES[key.scale].intervals.map((i) => noteName(key.root + i, key))
}

// ---------------------------------------------------------------- Chords

export type ChordType = "triad" | "seventh" | "ninth" | "sus2" | "sus4"

export const CHORD_TYPES: { value: ChordType; label: string }[] = [
  { value: "triad", label: "Triad" },
  { value: "seventh", label: "7th" },
  { value: "ninth", label: "9th" },
  { value: "sus2", label: "Sus2" },
  { value: "sus4", label: "Sus4" },
]

export interface Chord {
  id: string
  degree: number // 0-6
  type: ChordType
  inversion: number // 0-3
  beats: number
}

function chordDegrees(chord: Pick<Chord, "degree" | "type">) {
  const d = chord.degree
  switch (chord.type) {
    case "seventh":
      return [d, d + 2, d + 4, d + 6]
    case "ninth":
      return [d, d + 2, d + 4, d + 6, d + 8]
    case "sus2":
      return [d, d + 1, d + 4]
    case "sus4":
      return [d, d + 3, d + 4]
    default:
      return [d, d + 2, d + 4]
  }
}

/** Degrees (mod 7) belonging to the chord — used for melody generation. */
export function chordToneClasses(chord: Pick<Chord, "degree" | "type">) {
  return chordDegrees(chord).map((d) => d % 7)
}

/** Root-position MIDI notes. */
function rootPosition(chord: Pick<Chord, "degree" | "type">, key: Key) {
  const base = chordBase(key)
  return chordDegrees(chord).map((d) => degreeToMidi(d, key, base))
}

export function chordMidi(chord: Chord, key: Key) {
  const notes = rootPosition(chord, key)
  const inv = Math.min(chord.inversion, notes.length - 1)
  for (let i = 0; i < inv; i++) notes.push((notes.shift() as number) + 12)
  return notes
}

export function chordBassMidi(chord: Chord, key: Key) {
  return rootPosition(chord, key)[0] - 12
}

function qualityOf(chord: Pick<Chord, "degree" | "type">, key: Key) {
  const n = rootPosition(chord, key).map((m, _i, arr) => m - arr[0])
  return n
}

export function chordName(
  chord: Pick<Chord, "degree" | "type" | "inversion">,
  key: Key
) {
  const notes = rootPosition(chord, key)
  const root = noteName(notes[0], key)
  const iv = qualityOf(chord, key)
  let suffix: string

  if (chord.type === "sus2" || chord.type === "sus4") {
    const n =
      chord.type === "sus2"
        ? "2"
        : iv[1] === 6
          ? "♯4"
          : iv[1] === 4
            ? "♭4"
            : "4"
    const sus = chord.type === "sus2" && iv[1] === 1 ? "sus♭2" : `sus${n}`
    suffix = sus + (iv[2] === 6 ? "(♭5)" : iv[2] === 8 ? "(♯5)" : "")
  } else {
    const third = iv[1]
    const fifth = iv[2]
    const tri =
      third === 4 && fifth === 7
        ? "maj"
        : third === 3 && fifth === 7
          ? "min"
          : third === 3 && fifth === 6
            ? "dim"
            : third === 4 && fifth === 8
              ? "aug"
              : "maj"
    if (chord.type === "triad") {
      suffix = { maj: "", min: "m", dim: "dim", aug: "aug" }[tri]
    } else {
      const sev = iv[3]
      const ext = chord.type === "ninth" ? "9" : "7"
      if (tri === "maj") suffix = sev === 11 ? `maj${ext}` : ext
      else if (tri === "min") suffix = sev === 11 ? `m(maj${ext})` : `m${ext}`
      else if (tri === "dim") suffix = sev === 9 ? `dim7` : `m7♭5`
      else suffix = sev === 11 ? `maj7♯5` : `7♯5`
      if (chord.type === "ninth" && (tri === "dim" || tri === "aug"))
        suffix += "(add9)"
      if (chord.type === "ninth" && iv[4] === 13)
        suffix = suffix.replace("9", "7") + "(♭9)"
    }
  }

  let name = root + suffix
  if (chord.inversion > 0) {
    const inv = chordMidi({ ...chord, id: "", beats: 0 } as Chord, key)
    name += `/${noteName(inv[0], key)}`
  }
  return name
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"]

export function romanNumeral(chord: Pick<Chord, "degree" | "type">, key: Key) {
  const iv = qualityOf(
    {
      degree: chord.degree,
      type:
        chord.type === "triad" || chord.type.startsWith("sus")
          ? "triad"
          : chord.type,
    },
    key
  )
  const base = NUMERALS[chord.degree]
  if (chord.type === "sus2" || chord.type === "sus4")
    return `${base}${chord.type}`
  const third = iv[1]
  const fifth = iv[2]
  let r = third === 3 ? base.toLowerCase() : base
  if (third === 3 && fifth === 6) {
    if (chord.type === "triad") r += "°"
    else r += iv[3] === 9 ? "°7" : "ø7"
    return r
  }
  if (third === 4 && fifth === 8) r += "+"
  const maj7 = iv[3] === 11
  if (chord.type === "seventh")
    r += maj7 ? (third === 4 ? "maj7" : "(maj7)") : "7"
  if (chord.type === "ninth")
    r += maj7 ? (third === 4 ? "maj9" : "(maj9)") : "9"
  return r
}

// ---------------------------------------------------------------- Presets

export interface Preset {
  id: string
  label: string
  degrees: number[]
  type?: ChordType
  beats?: number
}

export const PRESETS: Preset[] = [
  { id: "pop", label: "Pop (I–V–vi–IV)", degrees: [0, 4, 5, 3] },
  { id: "doowop", label: "50s (I–vi–IV–V)", degrees: [0, 5, 3, 4] },
  { id: "sad", label: "Emotional (vi–IV–I–V)", degrees: [5, 3, 0, 4] },
  { id: "jazz", label: "Jazz ii–V–I", degrees: [1, 4, 0, 0], type: "seventh" },
  { id: "andalusian", label: "Andalusian (i–VII–VI–V)", degrees: [0, 6, 5, 4] },
  {
    id: "canon",
    label: "Canon (8 chords)",
    degrees: [0, 4, 5, 2, 3, 0, 3, 4],
    beats: 2,
  },
  { id: "rock", label: "Rock (I–IV–V–IV)", degrees: [0, 3, 4, 3] },
  {
    id: "dreamy",
    label: "Dreamy (IV–I–V–vi)",
    degrees: [3, 0, 4, 5],
    type: "seventh",
  },
]

export function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export function chordsFromPreset(preset: Preset): Chord[] {
  return preset.degrees.map((degree) => ({
    id: uid(),
    degree,
    type: preset.type ?? "triad",
    inversion: 0,
    beats: preset.beats ?? 4,
  }))
}

// ---------------------------------------------------------------- Random

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rand: () => number, arr: T[]) {
  return arr[Math.floor(rand() * arr.length)]
}

function weightedPick<T>(rand: () => number, items: { item: T; w: number }[]) {
  const total = items.reduce((s, i) => s + i.w, 0)
  let r = rand() * total
  for (const i of items) {
    r -= i.w
    if (r <= 0) return i.item
  }
  return items[items.length - 1].item
}

const TRANSITIONS: Record<number, number[]> = {
  0: [3, 4, 5, 1, 2, 3, 4, 5],
  1: [4, 4, 6, 3],
  2: [5, 3, 5],
  3: [4, 0, 1, 4, 5],
  4: [0, 5, 0, 3],
  5: [3, 1, 4, 3],
  6: [0, 2, 5],
}

export function randomProgression(
  length = 4,
  withSevenths = false,
  seed = Date.now()
): Chord[] {
  const rand = mulberry32(seed)
  const degrees = [rand() < 0.75 ? 0 : 5]
  while (degrees.length < length) {
    let next = pick(rand, TRANSITIONS[degrees[degrees.length - 1]])
    if (degrees.length === length - 1 && rand() < 0.7) next = pick(rand, [4, 3])
    if (next === degrees[degrees.length - 1]) next = (next + 3) % 7
    degrees.push(next)
  }
  return degrees.map((degree) => ({
    id: uid(),
    degree,
    type: withSevenths && rand() < 0.5 ? "seventh" : "triad",
    inversion: 0,
    beats: 4,
  }))
}

// ---------------------------------------------------------------- Melody

/** One melody step = an eighth note (half a beat). */
export const STEPS_PER_BEAT = 2
export const MELODY_RANGE = 15 // degrees 0..14 (two octaves + tonic)

export interface MelodyNote {
  id: string
  start: number // in steps
  length: number // in steps
  degree: number // 0..MELODY_RANGE-1
  /** Locked notes survive Generate, bar regeneration and motif repeats. */
  locked?: boolean
}

export function totalBeats(chords: Chord[]) {
  return chords.reduce((s, c) => s + c.beats, 0)
}

export function chordAtStep(chords: Chord[], step: number) {
  let s = 0
  for (const c of chords) {
    const len = c.beats * STEPS_PER_BEAT
    if (step < s + len) return { chord: c, offset: step - s, start: s }
    s += len
  }
  return null
}

export interface MelodyOptions {
  density: number // 0..1
  seed: number
}

export function generateMelody(
  chords: Chord[],
  opts: MelodyOptions
): MelodyNote[] {
  const rand = mulberry32(opts.seed)
  const total = totalBeats(chords) * STEPS_PER_BEAT
  const starts: number[] = []

  for (let step = 0; step < total; step++) {
    const at = chordAtStep(chords, step)
    if (!at) break
    const onChord = at.offset === 0
    const onBeat = step % STEPS_PER_BEAT === 0
    const onBar = step % (4 * STEPS_PER_BEAT) === 0
    const p =
      onChord || onBar
        ? 0.9
        : onBeat
          ? 0.25 + opts.density * 0.65
          : opts.density * 0.6
    if (rand() < p) starts.push(step)
  }

  const notes: MelodyNote[] = []
  let prev = 7 + Math.floor(rand() * 3)
  starts.forEach((start, i) => {
    const next = i + 1 < starts.length ? starts[i + 1] : total
    let length = Math.min(next - start, 4)
    if (length > 1 && rand() < 0.15) length -= 1 // little breath

    const at = chordAtStep(chords, start)!
    const strong = at.offset === 0 || start % STEPS_PER_BEAT === 0
    const tones = chordToneClasses(at.chord)
    const isLast = i === starts.length - 1

    const candidates: { item: number; w: number }[] = []
    for (let d = 0; d < MELODY_RANGE; d++) {
      const dist = Math.abs(d - prev)
      if (dist > 5) continue
      const isTone = tones.includes(d % 7)
      let w = [1.2, 4, 3, 1.5, 0.8, 0.4][dist]
      if (strong && isTone) w *= 3.5
      if (strong && !isTone) w *= 0.25
      if (!strong && isTone) w *= 1.3
      if (d <= 1 || d >= MELODY_RANGE - 2) w *= 0.5 // keep away from edges
      candidates.push({ item: d, w })
    }
    let degree = weightedPick(rand, candidates)
    if (isLast) {
      degree = [0, 7, 14].reduce(
        (best, t) => (Math.abs(t - prev) < Math.abs(best - prev) ? t : best),
        7
      )
      length = Math.max(length, Math.min(next - start, 4))
    }
    prev = degree
    notes.push({ id: uid(), start, length, degree })
  })
  return notes
}

// ---------------------------------------------------------------- Bar tools

export const STEPS_PER_BAR = STEPS_PER_BEAT * 4

/** Does `a` overlap `b` in time? */
export function overlaps(a: MelodyNote, b: MelodyNote) {
  return a.start < b.start + b.length && b.start < a.start + a.length
}

/**
 * Lay `top` over `base`: base notes that start inside a top note are dropped,
 * and base notes that run into one are shortened (the melody is monophonic).
 */
export function overlay(base: MelodyNote[], top: MelodyNote[]) {
  const out: MelodyNote[] = []
  for (const n of base) {
    let length = n.length
    let dropped = false
    for (const k of top) {
      if (n.start >= k.start && n.start < k.start + k.length) dropped = true
      else if (n.start < k.start && n.start + length > k.start)
        length = k.start - n.start
    }
    if (!dropped) out.push(length === n.length ? n : { ...n, length })
  }
  return [...out, ...top].sort((a, b) => a.start - b.start)
}

/** Replace the unlocked notes in steps [s0, s1) with `fresh`; locked notes win any overlap. */
function replaceRange(
  melody: MelodyNote[],
  s0: number,
  s1: number,
  fresh: MelodyNote[]
) {
  const kept = melody
    .filter((n) => n.locked || n.start < s0 || n.start >= s1)
    .map((n) =>
      !n.locked && n.start < s0 && n.start + n.length > s0
        ? { ...n, length: s0 - n.start }
        : n
    )
  return overlay(fresh, kept)
}

function barRange(chords: Chord[], bar: number) {
  const total = totalBeats(chords) * STEPS_PER_BEAT
  const s0 = bar * STEPS_PER_BAR
  return [s0, Math.min(s0 + STEPS_PER_BAR, total)] as const
}

/** Keep locked notes, generate everything else. */
export function generateAroundLocked(
  melody: MelodyNote[],
  chords: Chord[],
  opts: MelodyOptions
) {
  return overlay(
    generateMelody(chords, opts),
    melody.filter((n) => n.locked)
  )
}

/** Generate new notes for one bar, leaving the rest of the melody (and locked notes) alone. */
export function regenerateBar(
  melody: MelodyNote[],
  chords: Chord[],
  bar: number,
  opts: MelodyOptions
) {
  const [s0, s1] = barRange(chords, bar)
  const fresh = generateMelody(chords, opts)
    .filter((n) => n.start >= s0 && n.start < s1)
    .map((n) => ({ ...n, length: Math.min(n.length, s1 - n.start) }))
  return replaceRange(melody, s0, s1, fresh)
}

/** Remove the unlocked notes that start in a bar. */
export function clearBar(melody: MelodyNote[], chords: Chord[], bar: number) {
  const [s0, s1] = barRange(chords, bar)
  return replaceRange(melody, s0, s1, [])
}

/** Lock or unlock every note that starts in a bar. */
export function lockBar(
  melody: MelodyNote[],
  chords: Chord[],
  bar: number,
  locked: boolean
) {
  const [s0, s1] = barRange(chords, bar)
  return melody.map((n) =>
    n.start >= s0 && n.start < s1 ? { ...n, locked } : n
  )
}

/**
 * Copy the motif in bar `from` onto each target bar. With `followChords`, the
 * copy moves up/down the scale by the distance between the two bars' chords
 * (the nearest way), so a phrase written over I lands on the IV chord's notes.
 */
export function repeatBar(
  melody: MelodyNote[],
  chords: Chord[],
  from: number,
  targets: number[],
  followChords: boolean
) {
  const [a0, a1] = barRange(chords, from)
  const motif = melody
    .filter((n) => n.start >= a0 && n.start < a1)
    .map((n) => ({ ...n, length: Math.min(n.length, a1 - n.start) }))
  const srcChord = chordAtStep(chords, a0)?.chord
  let out = melody
  for (const bar of targets) {
    if (bar === from) continue
    const [s0, s1] = barRange(chords, bar)
    if (s0 >= s1) continue
    let shift = 0
    const dstChord = chordAtStep(chords, s0)?.chord
    if (followChords && srcChord && dstChord) {
      shift = (((dstChord.degree - srcChord.degree) % 7) + 7) % 7
      if (shift > 3) shift -= 7
    }
    const fresh = motif
      .map((n) => {
        let degree = n.degree + shift
        while (degree > MELODY_RANGE - 1) degree -= 7
        while (degree < 0) degree += 7
        const start = s0 + (n.start - a0)
        return {
          id: uid(),
          start,
          length: Math.min(n.length, s1 - start),
          degree,
        }
      })
      .filter((n) => n.start < s1)
    out = replaceRange(out, s0, s1, fresh)
  }
  return out
}

// ---------------------------------------------------------------- Voice leading

export interface Voicing {
  notes: number[]
  /** Inversion actually used (0 = root position). */
  inversion: number
}

const VOICING_LOW = 40 // E2 — lowest note a chord voicing may use
const VOICING_HIGH = 81 // A5 — highest
const VOICING_CENTER = 58

/** Total movement between two voicings (each note to its nearest note in the other chord). */
function voiceDistance(a: number[], b: number[]) {
  const near = (n: number, set: number[]) =>
    Math.min(...set.map((m) => Math.abs(m - n)))
  return (
    a.reduce((s, n) => s + near(n, b), 0) +
    b.reduce((s, n) => s + near(n, a), 0)
  )
}

/**
 * Voice every chord in the progression. With `smooth`, each chord after the
 * first picks the inversion/octave that moves the fewest semitones from the
 * previous chord (the first chord keeps its chosen inversion).
 */
export function voiceChords(
  chords: Chord[],
  key: Key,
  smooth: boolean
): Voicing[] {
  const out: Voicing[] = []
  chords.forEach((chord, i) => {
    if (!smooth || i === 0) {
      out.push({ notes: chordMidi(chord, key), inversion: chord.inversion })
      return
    }
    const prev = out[i - 1].notes
    let best: Voicing | null = null
    let bestCost = Infinity
    const size = chordDegrees(chord).length
    for (let inversion = 0; inversion < size; inversion++) {
      const base = chordMidi({ ...chord, inversion }, key)
      for (const shift of [-12, 0, 12]) {
        const notes = base.map((n) => n + shift)
        if (notes[0] < VOICING_LOW || notes[notes.length - 1] > VOICING_HIGH)
          continue
        const center = notes.reduce((s, n) => s + n, 0) / notes.length
        // Prefer small movement; gently pull toward the middle register to avoid drifting.
        const cost =
          voiceDistance(prev, notes) + Math.abs(center - VOICING_CENTER) * 0.3
        if (cost < bestCost) {
          bestCost = cost
          best = { notes, inversion }
        }
      }
    }
    out.push(
      best ?? { notes: chordMidi(chord, key), inversion: chord.inversion }
    )
  })
  return out
}
