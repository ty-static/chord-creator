import {
  type Chord,
  type Key,
  type MelodyNote,
  STEPS_PER_BEAT,
  chordMidi,
  voiceChords,
  degreeToMidi,
  keySignature,
  melodyBase,
  sectionKey,
} from "@/lib/music"
import type { TrackInstruments } from "@/lib/instruments"
import type { Mix } from "@/lib/audio-engine"
import { type BassStyle, bassLine } from "@/lib/bass"
import { type MeterId, barBeats, barSteps, meterOf } from "@/lib/meter"
import { type ChordStyle, chordHits } from "@/lib/rhythm"
import {
  DRUM_PIECES,
  DRUM_STEPS,
  DRUM_STEPS_PER_BEAT,
  type DrumSettings,
  drumHits,
} from "@/lib/drums"
import {
  HUMANIZE_TIME,
  HUMANIZE_VELOCITY,
  clampVelocity,
  noise,
  swingTime,
} from "@/lib/feel"

export type { ChordStyle } from "@/lib/rhythm"
export type TrackName = "chords" | "melody" | "bass" | "drums"
export const TRACK_NAMES: TrackName[] = ["chords", "melody", "bass", "drums"]

export interface NoteEvent {
  midi: number
  start: number // beats
  duration: number // beats
  velocity: number // 1..127
  track: TrackName
}

/** A block of the song (verse, chorus…) with its own chords, melody and beat. */
export interface Section {
  id: string
  name: string
  chords: Chord[]
  melody: MelodyNote[]
  drums: DrumSettings
  // How the section is played. All optional: unset means "as the song".
  /** Tracks that sit this section out, e.g. no drums in the intro. */
  tacet?: TrackName[]
  /** Chord rhythm for this section only. */
  chordStyle?: ChordStyle
  /** Bass pattern for this section only. */
  bassStyle?: BassStyle
  /** Loudness, from 0.5 (soft) to 1.5 (loud). 1 plays as written. */
  energy?: number
  /** Key change in semitones, e.g. 2 lifts a last chorus up a step. */
  transpose?: number
  /** Get louder over the last bars, into the next section. */
  buildUp?: boolean
  /** Tempo as a percentage of the song's, e.g. 50 for half time. */
  tempo?: number
  /** Slow down over the last bars (a ritardando). */
  slowDown?: boolean
}

/** Beats a build-up takes at most, and how much louder it ends. */
export const BUILD_UP_BEATS = 8
const BUILD_UP_FROM = 0.8
const BUILD_UP_TO = 1.3

const CRASH = DRUM_PIECES.find((d) => d.id === "crash")!.midi
const KICK = DRUM_PIECES.find((d) => d.id === "kick")!.midi

export const MIN_ENERGY = 0.5
export const MAX_ENERGY = 1.5
export const MAX_TRANSPOSE = 6

/** Whether a section is played differently from the rest of the song. */
export const hasSectionStyle = (s: Section) =>
  !!s.tacet?.length ||
  !!s.chordStyle ||
  !!s.bassStyle ||
  (s.energy ?? 1) !== 1 ||
  !!s.transpose ||
  !!s.buildUp ||
  (s.tempo ?? 100) !== 100 ||
  !!s.slowDown

/** One place in the song's form. The same section can appear in many slots. */
export interface Slot {
  id: string
  section: string
}

export interface Song {
  /** Shown in the song library and used for file names. */
  title: string
  key: Key
  bpm: number
  /** Time signature (4/4 when unset). */
  meter?: MeterId
  /** Every section, in letter order (A, B, C…). */
  sections: Section[]
  /** The form: which section plays when, e.g. A A B A. */
  arrangement: Slot[]
  chordStyle: ChordStyle
  bass: boolean
  /** The bass pattern (roots when unset). */
  bassStyle?: BassStyle
  instruments: TrackInstruments
  /** Reverb send amount 0..1 (playback only). */
  reverb: number
  /** Per-track volume / mute / solo. */
  mix: Mix
  /** Re-voice chords so each moves as little as possible from the last. */
  voiceLeading: boolean
  /** 0 = straight, 1 = full triplet swing. */
  swing?: number
  /** 0 = exact, 1 = the most timing and velocity variation. */
  humanize?: number
  /** A crash cymbal wherever the form moves to a different section. */
  crashOnChange?: boolean
  /** How the song ends (it just stops when unset). */
  ending?: Ending
}

export type Ending = "hold" | "stab" | "fade"

export const ENDINGS: { value: Ending; label: string; hint: string }[] = [
  {
    value: "hold",
    label: "Final chord",
    hint: "One more bar: the home chord, held, with a crash and the low root",
  },
  {
    value: "stab",
    label: "Short stab",
    hint: "One last short hit of the home chord on the next downbeat",
  },
  {
    value: "fade",
    label: "Fade out",
    hint: "The last bars get quieter until the song fades away",
  },
]

/** How many bars a fade-out takes at most. */
export const FADE_BARS = 4
const FADE_TO = 0.2

/** Beats the ending adds after the form (the bar of a final chord or stab). */
export const endingBeats = (song: Song) =>
  song.ending === "hold" || song.ending === "stab"
    ? barBeats(meterOf(song.meter))
    : 0

/** What one section needs to become notes. */
export type Part = Pick<
  Song,
  "key" | "chordStyle" | "bass" | "bassStyle" | "voiceLeading" | "meter"
> &
  Pick<
    Section,
    "chords" | "melody" | "drums" | "tacet" | "energy" | "transpose" | "buildUp"
  >

export const partOf = (song: Song, section: Section): Part => ({
  key: song.key,
  chordStyle: section.chordStyle ?? song.chordStyle,
  bass: song.bass,
  bassStyle: section.bassStyle ?? song.bassStyle,
  voiceLeading: song.voiceLeading,
  meter: song.meter,
  chords: section.chords,
  melody: section.melody,
  drums: section.drums,
  tacet: section.tacet,
  energy: section.energy,
  transpose: section.transpose,
  buildUp: section.buildUp,
})

/** A slot of the form placed on the song's beat grid. */
export interface Placed {
  slot: Slot
  section: Section
  /** Position of the slot in the form. */
  index: number
  start: number // beats
  beats: number
}

/** The form laid out in time. Slots whose section is gone are skipped. */
/** A key signature wherever the key changes between placed sections
 *  (for MIDI export), each from the first beat in the new key. */
export function keyChanges(
  key: Key,
  placed: Pick<Placed, "start" | "beats" | "section">[]
) {
  const out: { beat: number; sf: number; minor: boolean }[] = []
  let prev = 0
  for (const p of placed) {
    if (!p.beats) continue
    const t = p.section.transpose ?? 0
    if (t !== prev)
      out.push({ beat: p.start, ...keySignature(sectionKey(key, t)) })
    prev = t
  }
  return out
}

export function layout(song: Song): Placed[] {
  const byId = new Map(song.sections.map((s) => [s.id, s]))
  const out: Placed[] = []
  let start = 0
  song.arrangement.forEach((slot, index) => {
    const section = byId.get(slot.section)
    if (!section) return
    const beats = section.chords.reduce((n, c) => n + c.beats, 0)
    out.push({ slot, section, index, start, beats })
    start += beats
  })
  return out
}

/** Length of the whole song in beats. */
export const songBeats = (song: Song) =>
  layout(song).reduce((n, p) => n + p.beats, 0)

/** The slot playing at a beat, or null past the end. */
export function placedAt(placed: Placed[], beat: number) {
  return placed.find((p) => beat >= p.start && beat < p.start + p.beats) ?? null
}

/** Every note of the song, section after section in form order. */
export function buildEvents(
  song: Song,
  layers: Record<TrackName, boolean>
): NoteEvent[] {
  const cache = new Map<string, NoteEvent[]>()
  const events: NoteEvent[] = []
  const placed = layout(song)
  for (const p of placed) {
    // A crash where the form moves to a new section (not at the very start,
    // and not if the section already starts with one).
    const prev = placed[placed.indexOf(p) - 1]
    if (
      song.crashOnChange &&
      layers.drums &&
      p.section.drums.enabled &&
      !(p.section.tacet ?? []).includes("drums") &&
      prev &&
      prev.section.id !== p.section.id &&
      !p.section.drums.crashAtStart &&
      !p.section.drums.pattern.crash[0]
    )
      events.push({
        midi: CRASH,
        start: p.start,
        duration: 0.2,
        velocity: clampVelocity(110 * (p.section.energy ?? 1)),
        track: "drums",
      })
    let part = cache.get(p.section.id)
    if (!part) {
      part = partEvents(partOf(song, p.section), layers)
      cache.set(p.section.id, part)
    }
    const swing = song.swing ?? 0
    const human = song.humanize ?? 0
    const track = (t: TrackName) => TRACK_NAMES.indexOf(t)
    for (const e of part) {
      if (!swing && !human) {
        events.push({ ...e, start: e.start + p.start })
        continue
      }
      // Swing within the section, then nudge by a repeatable random amount.
      // Notes never move before the start of their slot, so a loop of the
      // slot still plays them.
      let start = swingTime(e.start, swing)
      const end = swingTime(e.start + e.duration, swing)
      let velocity = e.velocity
      if (human) {
        const seed = Math.round(e.start * 960)
        const id = e.midi * 8 + track(e.track)
        start += noise(p.index, id, seed) * HUMANIZE_TIME * human
        velocity = clampVelocity(
          velocity + noise(seed, p.index, id) * HUMANIZE_VELOCITY * human
        )
      }
      start = Math.max(0, start)
      events.push({
        ...e,
        start: start + p.start,
        duration: Math.max(0.05, end - start),
        velocity,
      })
    }
  }
  return song.ending ? withEnding(song, placed, events, layers) : events
}

/** Add the song's ending: a final chord or stab after the form, or a fade. */
function withEnding(
  song: Song,
  placed: Placed[],
  events: NoteEvent[],
  layers: Record<TrackName, boolean>
): NoteEvent[] {
  const last = placed.filter((p) => p.beats > 0).at(-1)
  if (!last) return events
  const end = last.start + last.beats
  const bar = barBeats(meterOf(song.meter))

  if (song.ending === "fade") {
    const length = Math.min(FADE_BARS * bar, end)
    const from = end - length
    return events.map((e) =>
      e.start < from
        ? e
        : {
            ...e,
            velocity: clampVelocity(
              e.velocity * (1 - ((1 - FADE_TO) * (e.start - from)) / length)
            ),
          }
    )
  }

  // The home chord of the last section's key, voiced to follow its last chord.
  const key = sectionKey(song.key, last.section.transpose)
  const tonic: Chord = {
    id: "ending",
    degree: 0,
    type: "triad",
    inversion: 0,
    beats: bar,
  }
  const lastChord = last.section.chords.at(-1)!
  const notes = voiceChords([lastChord, tonic], key, song.voiceLeading)[1].notes
  const hold = song.ending === "hold"
  const length = hold ? bar * 0.98 : 0.35
  const tacet = last.section.tacet ?? []
  const plays = (t: TrackName) => layers[t] && !tacet.includes(t)
  const out = [...events]
  if (plays("chords"))
    for (const midi of notes)
      out.push({
        midi,
        start: end,
        duration: length,
        velocity: hold ? 84 : 100,
        track: "chords",
      })
  if (plays("bass") && song.bass)
    out.push({
      midi: chordMidi(tonic, key)[0] - 12,
      start: end,
      duration: length,
      velocity: hold ? 92 : 104,
      track: "bass",
    })
  if (plays("drums") && last.section.drums.enabled)
    for (const midi of [CRASH, KICK])
      out.push({
        midi,
        start: end,
        duration: 0.2,
        velocity: 112,
        track: "drums",
      })
  return out
}

/** The notes of one section, starting at beat 0. */
export function partEvents(
  song: Part,
  allLayers: Record<TrackName, boolean>
): NoteEvent[] {
  const layers = { ...allLayers }
  for (const t of song.tacet ?? []) layers[t] = false
  const events: NoteEvent[] = []
  const meter = meterOf(song.meter)
  let t = 0

  const voicings = voiceChords(song.chords, song.key, song.voiceLeading)
  song.chords.forEach((chord, ci) => {
    const notes = voicings[ci].notes
    if (layers.chords)
      for (const h of chordHits(song.chordStyle, notes, t, chord.beats, meter))
        events.push({ ...h, track: "chords" })
    t += chord.beats
  })

  if (layers.bass && song.bass) {
    for (const n of bassLine(
      song.chords,
      song.key,
      song.bassStyle ?? "root",
      kickTimes(song.drums, t),
      meter
    ))
      events.push({ ...n, track: "bass" })
  }

  if (layers.melody) {
    const base = melodyBase(song.key)
    for (const n of song.melody) {
      events.push({
        midi: degreeToMidi(n.degree, song.key, base),
        start: n.start / STEPS_PER_BEAT,
        duration: (n.length / STEPS_PER_BEAT) * 0.95,
        velocity: n.start % barSteps(meter) === 0 ? 100 : 88,
        track: "melody",
      })
    }
  }
  if (layers.drums && song.drums.enabled) {
    const end = song.chords.reduce((s, c) => s + c.beats, 0)
    for (const h of drumHits(song.drums, end))
      events.push({
        midi: h.midi,
        start: h.start,
        duration: 0.2,
        velocity: h.velocity,
        track: "drums",
      })
  }

  const energy = song.energy ?? 1
  const shift = song.transpose ?? 0
  if (energy === 1 && !shift && !song.buildUp) return events
  // A build-up starts a little softer and swells into the next section.
  const end = t
  const ramp = Math.min(BUILD_UP_BEATS, end / 2)
  const swell = (start: number) =>
    !song.buildUp || start < end - ramp
      ? 1
      : BUILD_UP_FROM +
        ((BUILD_UP_TO - BUILD_UP_FROM) * (start - (end - ramp))) / ramp
  return events.map((e) => ({
    ...e,
    midi: e.track === "drums" ? e.midi : e.midi + shift,
    velocity: clampVelocity(e.velocity * energy * swell(e.start)),
  }))
}

/** When the kick drum plays in a section, in beats (fills left out). */
export function kickTimes(drums: DrumSettings, beats: number) {
  if (!drums.enabled) return []
  const out: number[] = []
  const steps = Math.round(beats * DRUM_STEPS_PER_BEAT)
  const bar = drums.pattern.kick.length || DRUM_STEPS
  for (let step = 0; step < steps; step++)
    if (drums.pattern.kick[step % bar]) out.push(step / DRUM_STEPS_PER_BEAT)
  return out
}
