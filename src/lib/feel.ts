// Swing and humanize: small changes to when and how hard notes play, so the
// song sounds less mechanical. Both are deterministic: the same song always
// plays (and exports) exactly the same way.

/** Most a note moves at full humanize, in beats (about 15 ms at 120 BPM). */
export const HUMANIZE_TIME = 0.03
/** Most a note's velocity changes at full humanize. */
export const HUMANIZE_VELOCITY = 14

/**
 * Move a time in beats by a swing amount (0 = straight, 1 = full triplet
 * swing). The off-beat 8th moves later and everything between follows, so
 * 16th notes swing in proportion and beats themselves stay put.
 */
export function swingTime(beat: number, swing: number) {
  if (swing <= 0) return beat
  const whole = Math.floor(beat)
  const x = beat - whole
  const mid = 0.5 + Math.min(1, swing) / 6
  return whole + (x < 0.5 ? x * 2 * mid : mid + (x - 0.5) * 2 * (1 - mid))
}

/** A repeatable pseudo-random number from -1 to 1 for the given inputs. */
export function noise(a: number, b: number, c: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b)
  h ^= Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h ^= Math.imul(c ^ 0x27d4eb2f, 0x165667b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

export const clampVelocity = (v: number) =>
  Math.max(1, Math.min(127, Math.round(v)))
