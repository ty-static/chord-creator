// Melody that ties sections together: reuse another section's melody, and
// lead the end of a section into the next one.
import {
  type Chord,
  MELODY_RANGE,
  type MelodyNote,
  type MelodyOptions,
  STEPS_PER_BEAT,
  chordAtStep,
  chordToneClasses,
  mulberry32,
  nearestTonic,
  overlay,
  pickDegree,
  totalBeats,
  uid,
} from "@/lib/music"

export type BorrowMode = "copy" | "follow" | "rhythm"

export const BORROW_MODES: { id: BorrowMode; label: string; hint: string }[] = [
  {
    id: "copy",
    label: "Same notes",
    hint: "The same tune, note for note",
  },
  {
    id: "follow",
    label: "Follow the chords",
    hint: "The same tune, moved up or down to fit this section's chords",
  },
  {
    id: "rhythm",
    label: "Same rhythm, new notes",
    hint: "Its rhythm with a new tune over this section's chords — related, not repeated",
  },
]

interface Part {
  chords: Chord[]
  melody: MelodyNote[]
}

const steps = (chords: Chord[]) => totalBeats(chords) * STEPS_PER_BEAT

/** Move a degree by octaves until it fits the melody range. */
function fold(degree: number) {
  while (degree > MELODY_RANGE - 1) degree -= 7
  while (degree < 0) degree += 7
  return degree
}

/** The nearest way (−3..3 scale steps) from one chord's root to another's. */
function rootShift(from: Chord, to: Chord) {
  const d = (((to.degree - from.degree) % 7) + 7) % 7
  return d > 3 ? d - 7 : d
}

/**
 * A melody for `target` built from `source`'s melody. A shorter source is
 * repeated to fill the section; a longer one is cut off. Locked notes in
 * the target stay.
 *
 * - `copy`: the same scale degrees.
 * - `follow`: each note moves by the distance between the chord under it in
 *   the source and the chord at the same moment in the target.
 * - `rhythm`: the same starts and lengths, with new pitches chosen like the
 *   generator does (chord tones on strong beats, mostly stepwise).
 */
export function borrowMelody(
  source: Part,
  target: Part,
  mode: BorrowMode,
  opts: MelodyOptions
): MelodyNote[] {
  const span = steps(source.chords)
  const total = steps(target.chords)
  const src = source.melody
    .filter((n) => n.start < span)
    .sort((a, b) => a.start - b.start)
  if (!span || !total || !src.length) return target.melody

  // Lay the source end to end until the target is full.
  const tiled: { note: MelodyNote; start: number; length: number }[] = []
  for (let offset = 0; offset < total; offset += span)
    for (const note of src) {
      const start = note.start + offset
      if (start >= total) break
      tiled.push({
        note,
        start,
        length: Math.min(note.length, span - note.start, total - start),
      })
    }

  const rand = mulberry32(opts.seed)
  let prev = tiled[0].note.degree
  const fresh = tiled.map(({ note, start, length }, i) => {
    let degree = note.degree
    const at = chordAtStep(target.chords, start)!
    if (mode === "follow") {
      const was = chordAtStep(source.chords, note.start)
      if (was) degree = fold(degree + rootShift(was.chord, at.chord))
    } else if (mode === "rhythm") {
      const strong = at.offset === 0 || start % STEPS_PER_BEAT === 0
      degree =
        i === tiled.length - 1
          ? nearestTonic(prev)
          : pickDegree(
              rand,
              prev,
              chordToneClasses(at.chord, opts.scale),
              strong
            )
    }
    prev = degree
    return { id: uid(), start, length, degree }
  })
  return overlay(
    fresh,
    target.melody.filter((n) => n.locked)
  )
}

/** Steps at the end of a section that a lead-in rewrites (a beat and a half). */
export const LEAD_IN_STEPS = 3

/**
 * Rewrite the last beat and a half of a section as a run of eighth notes
 * that steps into `target` — the degree (in this section's key) of the next
 * section's first note — so the tune carries across the change. The run
 * comes from the side of the note before it. Returns null when the section
 * is too short or a locked note is in the way.
 */
export function leadInto(
  melody: MelodyNote[],
  chords: Chord[],
  target: number
): MelodyNote[] | null {
  const total = steps(chords)
  const from = total - LEAD_IN_STEPS
  if (from < STEPS_PER_BEAT * 2) return null
  if (melody.some((n) => n.locked && n.start + n.length > from)) return null

  const before = melody
    .filter((n) => n.start < from)
    .sort((a, b) => a.start - b.start)
  const last = before[before.length - 1]
  // Come from above if the tune is above the target (or there's no tune).
  let dir = !last || last.degree >= target ? 1 : -1
  const fits = (d: number) =>
    [1, 2, 3].every((k) => {
      const deg = target + k * d
      return deg >= 0 && deg < MELODY_RANGE
    })
  if (!fits(dir)) dir = -dir
  if (!fits(dir)) return null

  const run = [3, 2, 1].map((k, i) => ({
    id: uid(),
    start: from + i,
    length: 1,
    degree: target + k * dir,
  }))
  const kept = before.map((n) =>
    n.start + n.length > from ? { ...n, length: from - n.start } : n
  )
  return [...kept, ...run]
}
