// Recognising chords and scale degrees from raw MIDI pitches, shared by MIDI
// file import and live MIDI keyboard input.

import {
  type ChordShape,
  type ChordType,
  type Key,
  MELODY_RANGE,
  SCALES,
  chordPitchClasses,
  chordToneClasses,
  degreeToMidi,
  melodyBase,
  outsideChords,
} from "@/lib/music"

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Pitch class (0–11) of a scale degree in a key. */
export function degreePc(key: Key, degree: number) {
  return mod(key.root + SCALES[key.scale].intervals[mod(degree, 7)], 12)
}

export interface ChordGuess {
  degree: number
  type: ChordType
  mode?: ChordShape["mode"]
  secondary?: boolean
  inversion: number
  /** Share of the sounding notes (by weight) that belong to the chord, 0..1. */
  fit: number
  score: number
}

/**
 * Pick the diatonic chord that best explains a set of pitch-class weights
 * (e.g. note durations). `bassPc` is the lowest sounding pitch class, used to
 * favour the chord built on it and to work out the inversion.
 */
export function guessChord(
  weights: number[],
  key: Key,
  bassPc: number | null,
  types: ChordType[] = ["triad", "seventh"],
  /** Also consider chords from outside the key (secondary dominants, borrowed). */
  outside = false
): ChordGuess | null {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  let best: ChordGuess | null = null
  for (let degree = 0; degree < 7; degree++) {
    for (const type of types) {
      const pcs = chordToneClasses({ degree, type }).map((d) =>
        degreePc(key, d)
      )
      const covered = [...new Set(pcs)].reduce((s, pc) => s + weights[pc], 0)
      const fit = covered / total
      const missing = pcs.filter((pc) => weights[pc] <= 0).length
      const root = pcs[0]
      let score = fit - 0.12 * missing
      if (bassPc === root) score += 0.2
      if (weights[root] > 0) score += 0.05
      if (degree === 0) score += 0.03
      else if (degree === 3 || degree === 4) score += 0.02
      if (type !== "triad") score -= 0.04 // prefer the simpler chord on a tie
      if (!best || score > best.score) {
        const idx = bassPc === null ? -1 : pcs.indexOf(bassPc)
        best = {
          degree,
          type,
          inversion: idx > 0 ? Math.min(idx, pcs.length - 1) : 0,
          fit,
          score,
        }
      }
    }
  }
  if (!outside) return best
  // An outside chord must explain the notes clearly better than any chord
  // in the key, so in-key playing never turns chromatic by accident.
  for (const { chord } of outsideChords(key))
    for (const type of types) {
      const shape: ChordShape = { ...chord, type }
      const pcs = chordPitchClasses(shape, key)
      const covered = [...new Set(pcs)].reduce((s, pc) => s + weights[pc], 0)
      const fit = covered / total
      const missing = pcs.filter((pc) => weights[pc] <= 0).length
      let score = fit - 0.12 * missing - 0.06
      if (bassPc === pcs[0]) score += 0.2
      if (type !== "triad") score -= 0.04
      if (best && score <= best.score) continue
      const idx = bassPc === null ? -1 : pcs.indexOf(bassPc)
      best = {
        ...shape,
        inversion: idx > 0 ? Math.min(idx, pcs.length - 1) : 0,
        fit,
        score,
      }
    }
  return best
}

/** Chord from notes held together (e.g. on a MIDI keyboard). */
export function chordFromPitches(pitches: number[], key: Key) {
  if (!pitches.length) return null
  const weights = Array<number>(12).fill(0)
  for (const p of pitches) weights[mod(p, 12)] += 1
  const lowest = Math.min(...pitches)
  if (new Set(pitches.map((p) => mod(p, 12))).size === 1) {
    // A single key: the triad built on that note's nearest scale degree.
    return {
      degree: mod(nearestDegree(lowest, key), 7),
      type: "triad" as ChordType,
      inversion: 0,
      fit: 1,
      score: 1,
    }
  }
  return guessChord(
    weights,
    key,
    mod(lowest, 12),
    ["triad", "seventh", "sus2", "sus4"],
    true
  )
}

/** Nearest scale degree to a MIDI pitch, counted from the melody tonic (may be out of range). */
export function nearestDegree(pitch: number, key: Key) {
  const base = melodyBase(key)
  let best = 0
  let bestDist = Infinity
  const approx = Math.round(((pitch - base) * 7) / 12)
  for (let d = approx - 3; d <= approx + 3; d++) {
    const dist = Math.abs(degreeToMidi(d, key, base) - pitch)
    // On a tie (an out-of-key note), round down.
    if (dist < bestDist) {
      best = d
      bestDist = dist
    }
  }
  return best
}

/** Fold a degree into the melody grid's range by octaves. */
export function foldDegree(degree: number) {
  let d = degree
  while (d < 0) d += 7
  while (d > MELODY_RANGE - 1) d -= 7
  return d
}

/** Is this MIDI pitch in the key? */
export function inKey(pitch: number, key: Key) {
  return SCALES[key.scale].intervals.some(
    (i) => mod(key.root + i, 12) === mod(pitch, 12)
  )
}

// Krumhansl–Kessler key profiles.
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
]
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
]

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** Estimate a major/minor key from pitch-class weights. */
export function detectKey(weights: number[]): Key {
  let best: Key = { root: 0, scale: "major" }
  let bestR = -Infinity
  for (let root = 0; root < 12; root++) {
    const rotated = weights.map((_, i) => weights[mod(i + root, 12)])
    for (const [scale, profile] of [
      ["major", MAJOR_PROFILE],
      ["minor", MINOR_PROFILE],
    ] as const) {
      const r = correlate(rotated, profile)
      if (r > bestR) {
        bestR = r
        best = { root, scale }
      }
    }
  }
  return best
}

/** Key from a MIDI key-signature meta event. */
export function keyFromSignature(sf: number, minor: boolean): Key {
  const majorRoot = mod(sf * 7, 12)
  return minor
    ? { root: mod(majorRoot + 9, 12), scale: "minor" }
    : { root: majorRoot, scale: "major" }
}
