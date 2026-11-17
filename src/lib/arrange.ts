import {
  type Chord,
  type Key,
  type MelodyNote,
  STEPS_PER_BEAT,
  chordBassMidi,
  voiceChords,
  degreeToMidi,
  melodyBase,
} from "@/lib/music"
import type { TrackInstruments } from "@/lib/instruments"
import type { Mix } from "@/lib/audio-engine"
import { type DrumSettings, drumHits } from "@/lib/drums"
import {
  HUMANIZE_TIME,
  HUMANIZE_VELOCITY,
  clampVelocity,
  noise,
  swingTime,
} from "@/lib/feel"

export type ChordStyle = "block" | "pulse" | "arpeggio"
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
  /** Loudness, from 0.5 (soft) to 1.5 (loud). 1 plays as written. */
  energy?: number
  /** Key change in semitones, e.g. 2 lifts a last chorus up a step. */
  transpose?: number
}

export const MIN_ENERGY = 0.5
export const MAX_ENERGY = 1.5
export const MAX_TRANSPOSE = 6

/** Whether a section is played differently from the rest of the song. */
export const hasSectionStyle = (s: Section) =>
  !!s.tacet?.length || !!s.chordStyle || (s.energy ?? 1) !== 1 || !!s.transpose

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
  /** Every section, in letter order (A, B, C…). */
  sections: Section[]
  /** The form: which section plays when, e.g. A A B A. */
  arrangement: Slot[]
  chordStyle: ChordStyle
  bass: boolean
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
}

/** What one section needs to become notes. */
export type Part = Pick<Song, "key" | "chordStyle" | "bass" | "voiceLeading"> &
  Pick<
    Section,
    "chords" | "melody" | "drums" | "tacet" | "energy" | "transpose"
  >

export const partOf = (song: Song, section: Section): Part => ({
  key: song.key,
  chordStyle: section.chordStyle ?? song.chordStyle,
  bass: song.bass,
  voiceLeading: song.voiceLeading,
  chords: section.chords,
  melody: section.melody,
  drums: section.drums,
  tacet: section.tacet,
  energy: section.energy,
  transpose: section.transpose,
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
  for (const p of layout(song)) {
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
  return events
}

/** The notes of one section, starting at beat 0. */
export function partEvents(
  song: Part,
  allLayers: Record<TrackName, boolean>
): NoteEvent[] {
  const layers = { ...allLayers }
  for (const t of song.tacet ?? []) layers[t] = false
  const events: NoteEvent[] = []
  let t = 0

  const voicings = voiceChords(song.chords, song.key, song.voiceLeading)
  song.chords.forEach((chord, ci) => {
    const notes = voicings[ci].notes
    if (layers.chords) {
      if (song.chordStyle === "block") {
        for (const midi of notes)
          events.push({
            midi,
            start: t,
            duration: chord.beats * 0.98,
            velocity: 76,
            track: "chords",
          })
      } else if (song.chordStyle === "pulse") {
        for (let b = 0; b < chord.beats; b++)
          for (const midi of notes)
            events.push({
              midi,
              start: t + b,
              duration: 0.85,
              velocity: b % 2 === 0 ? 80 : 66,
              track: "chords",
            })
      } else {
        const pattern = [...notes, ...notes.slice(1, -1).reverse()]
        const steps = chord.beats * 2
        for (let s = 0; s < steps; s++)
          events.push({
            midi: pattern[s % pattern.length],
            start: t + s / 2,
            duration: 0.48,
            velocity: s % 2 === 0 ? 78 : 64,
            track: "chords",
          })
      }
    }
    if (layers.bass && song.bass) {
      events.push({
        midi: chordBassMidi(chord, song.key),
        start: t,
        duration: chord.beats * 0.98,
        velocity: 90,
        track: "bass",
      })
    }
    t += chord.beats
  })

  if (layers.melody) {
    const base = melodyBase(song.key)
    for (const n of song.melody) {
      events.push({
        midi: degreeToMidi(n.degree, song.key, base),
        start: n.start / STEPS_PER_BEAT,
        duration: (n.length / STEPS_PER_BEAT) * 0.95,
        velocity: n.start % (STEPS_PER_BEAT * 4) === 0 ? 100 : 88,
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
  if (energy === 1 && !shift) return events
  return events.map((e) => ({
    ...e,
    midi: e.track === "drums" ? e.midi : e.midi + shift,
    velocity: clampVelocity(e.velocity * energy),
  }))
}
