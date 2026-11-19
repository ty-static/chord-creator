// Chord suggestions: which chords to try next, best first, each with the
// reason it's suggested. A chord scores for being a common move from the
// last one, for carrying on a well-known loop the last chords started, and
// for landing a cadence at the end of a phrase.

import {
  type Chord,
  type ChordShape,
  type Key,
  SCALES,
  isOutside,
  outsideChords,
  romanNumeral,
  suggestNext,
} from "@/lib/music"

export interface Suggestion {
  chord: ChordShape
  /** Why it's suggested, e.g. "Completes I–V–vi–IV". */
  reason: string
}

/** How often each degree follows each degree (rough shares from pop songs). */
const MAJOR_MOVES: Record<number, Record<number, number>> = {
  0: { 3: 0.3, 4: 0.3, 5: 0.2, 1: 0.1, 2: 0.05 },
  1: { 4: 0.5, 3: 0.15, 0: 0.1, 5: 0.1, 2: 0.05 },
  2: { 5: 0.4, 3: 0.3, 1: 0.15, 0: 0.05 },
  3: { 0: 0.35, 4: 0.35, 5: 0.1, 1: 0.1, 2: 0.05 },
  4: { 0: 0.45, 5: 0.3, 3: 0.2 },
  5: { 3: 0.45, 4: 0.25, 1: 0.15, 2: 0.05, 0: 0.05 },
  6: { 0: 0.6, 2: 0.2, 5: 0.1 },
}
const MINOR_MOVES: Record<number, Record<number, number>> = {
  0: { 5: 0.3, 3: 0.25, 6: 0.2, 4: 0.1, 2: 0.1 },
  1: { 4: 0.6, 0: 0.15, 3: 0.1 },
  2: { 5: 0.3, 6: 0.3, 3: 0.2, 0: 0.1 },
  3: { 0: 0.3, 6: 0.25, 4: 0.2, 5: 0.15 },
  4: { 0: 0.4, 5: 0.3, 3: 0.15 },
  5: { 6: 0.35, 0: 0.2, 2: 0.2, 3: 0.15 },
  6: { 0: 0.4, 2: 0.3, 5: 0.15 },
}

/** Well-known loops, as degrees (any rotation counts). */
const MAJOR_LOOPS = [
  [0, 4, 5, 3], // I–V–vi–IV
  [0, 5, 3, 4], // I–vi–IV–V
  [0, 3, 4, 3], // I–IV–V–IV
  [1, 4, 0, 0], // ii–V–I
  [0, 3, 5, 4], // I–IV–vi–V
  [5, 3, 0, 4], // vi–IV–I–V (a rotation of the first, kept for its name)
  [0, 2, 3, 4], // I–iii–IV–V
]
const MINOR_LOOPS = [
  [0, 5, 2, 6], // i–VI–III–VII
  [0, 6, 5, 6], // i–VII–VI–VII
  [0, 3, 4, 0], // i–iv–v–i
  [5, 6, 0, 0], // VI–VII–i
  [0, 5, 6, 0], // i–VI–VII–i
]

const NUMERAL_DASH = "–"
/** Bars in a phrase: cadences land on the last bar of each. */
export const PHRASE_BARS = 4

const triad = (degree: number): ChordShape => ({ degree, type: "triad" })
const plain = (c: ChordShape) => !isOutside(c)

/** The loop the last chords are in, and the chord that carries it on. */
function loopNext(degrees: number[], loops: number[][]) {
  for (const len of [3, 2]) {
    if (degrees.length < len) continue
    const tail = degrees.slice(-len)
    for (const loop of loops)
      for (let r = 0; r < loop.length; r++) {
        const at = (i: number) => loop[(r + i) % loop.length]
        if (tail.every((d, i) => at(i) === d))
          return {
            next: at(len),
            name: [0, 1, 2, 3].map((i) => at(i)),
            strength: len === 3 ? 1 : 0.6,
          }
      }
  }
  return null
}

/**
 * Chords to try after the progression so far, best first. `bar` is the
 * length of a bar in beats, for finding the ends of phrases.
 */
export function suggestChords(
  chords: Pick<Chord, "degree" | "type" | "mode" | "secondary" | "beats">[],
  key: Key,
  opts: { bar: number }
): Suggestion[] {
  const last = chords.at(-1)
  const numeral = (c: ChordShape) => romanNumeral(c, key)
  if (!last) {
    const [home, relative, four] = suggestNext(undefined, key)
    return [
      { chord: home, reason: "Start at home, on the key's own chord" },
      { chord: relative, reason: "Start somewhere moodier" },
      { chord: four, reason: "Start away from home, and arrive there later" },
    ].filter((s) => s.chord)
  }
  // After a chord from outside the key: where it wants to go.
  if (!plain(last))
    return suggestNext(last, key).map((chord, i) => ({
      chord,
      reason:
        i === 0
          ? `Where ${numeral(last)} wants to go`
          : `Also follows ${numeral(last)}`,
    }))

  const minor = SCALES[key.scale].minor
  const moves = (minor ? MINOR_MOVES : MAJOR_MOVES)[last.degree] ?? {}
  const degrees = chords.filter(plain).map((c) => c.degree)
  const loop = loopNext(degrees, minor ? MINOR_LOOPS : MAJOR_LOOPS)

  // Where the next chord starts: which bar of the phrase.
  const beats = chords.reduce((n, c) => n + c.beats, 0)
  const barIndex = Math.floor(beats / opts.bar + 1e-9)
  const phraseEnd = barIndex % PHRASE_BARS === PHRASE_BARS - 1
  const phraseStart = barIndex > 0 && barIndex % PHRASE_BARS === 0
  const first = chords[0]

  const scored = [0, 1, 2, 3, 4, 5, 6]
    .filter((d) => d !== last.degree)
    .map((d) => {
      const chord = triad(d)
      const reasons: [number, string][] = []
      const common = moves[d] ?? 0
      if (common) reasons.push([common, `Often follows ${numeral(last)}`])
      if (loop?.next === d)
        reasons.push([
          0.5 * loop.strength,
          `Carries on ${loop.name.map((x) => numeral(triad(x))).join(NUMERAL_DASH)}`,
        ])
      if (phraseEnd && (d === 4 || d === 0))
        reasons.push([
          0.3,
          d === 4
            ? `Ends the phrase on ${numeral(chord)}, leaving it open`
            : "Ends the phrase back home",
        ])
      if (phraseStart && first && plain(first) && d === first.degree)
        reasons.push([0.3, "Starts the next phrase like the first"])
      const score = reasons.reduce((n, [s]) => n + s, 0)
      const best = [...reasons].sort((a, b) => b[0] - a[0])[0]
      return { chord, score, reason: best?.[1] ?? "" }
    })
    .filter((s) => s.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)

  // One colourful choice: in a minor key the major V, otherwise the
  // secondary dominant that leads into the top pick away from home.
  const offered = outsideChords(key).map((o) => o.chord)
  const target = scored.find((x) => x.chord.degree !== 0)?.chord.degree
  const lead = offered.find((c) => c.secondary && c.degree === target)
  const major5 =
    minor && last.degree !== 4
      ? offered.find((c) => c.degree === 4 && c.mode === "harmonicMinor")
      : undefined
  const colour = major5 ?? lead
  return [
    ...scored.map(({ chord, reason }) => ({ chord, reason })),
    ...(colour
      ? [
          {
            chord: colour,
            reason: colour.secondary
              ? `Leads strongly into ${numeral(triad(colour.degree))}`
              : "The major V: a stronger pull home",
          },
        ]
      : []),
  ]
}
