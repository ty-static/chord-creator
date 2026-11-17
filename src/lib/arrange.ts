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
}

/** One place in the song's form. The same section can appear in many slots. */
export interface Slot {
  id: string
  section: string
}

export interface Song {
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
}

/** What one section needs to become notes. */
export type Part = Pick<Song, "key" | "chordStyle" | "bass" | "voiceLeading"> &
  Pick<Section, "chords" | "melody" | "drums">

export const partOf = (song: Song, section: Section): Part => ({
  key: song.key,
  chordStyle: song.chordStyle,
  bass: song.bass,
  voiceLeading: song.voiceLeading,
  chords: section.chords,
  melody: section.melody,
  drums: section.drums,
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
    for (const e of part) events.push({ ...e, start: e.start + p.start })
  }
  return events
}

/** The notes of one section, starting at beat 0. */
export function partEvents(
  song: Part,
  layers: Record<TrackName, boolean>
): NoteEvent[] {
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
  return events
}
