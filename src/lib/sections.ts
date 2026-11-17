// Song sections (verse, chorus, bridge…) and the form that orders them.
// Everything here is pure: each function returns a new song.

import type { Section, Slot, Song } from "@/lib/arrange"
import { DEFAULT_DRUMS, type DrumSettings } from "@/lib/drums"
import { type Chord, type MelodyNote, uid } from "@/lib/music"

/** At most this many sections (letters A–H) and slots in the form. */
export const MAX_SECTIONS = 8
export const MAX_SLOTS = 32

/** Names offered for new sections, in the order they're usually added. */
export const SECTION_NAMES = [
  "Verse",
  "Chorus",
  "Bridge",
  "Intro",
  "Outro",
  "Pre-chorus",
  "Breakdown",
  "Solo",
]

export const sectionLetter = (index: number) => String.fromCharCode(65 + index)

export function letterOf(song: Song, sectionId: string) {
  const i = song.sections.findIndex((s) => s.id === sectionId)
  return i < 0 ? "?" : sectionLetter(i)
}

/** The form as letters, e.g. "A A B A". */
export const formString = (song: Song) =>
  song.arrangement.map((slot) => letterOf(song, slot.section)).join(" ")

/**
 * Read a form typed as letters ("A A B A", "aaba", "A-B-A").
 * Returns the new slots, or an error naming the letter with no section.
 */
export function parseForm(
  song: Song,
  text: string
): { slots: Slot[] } | { error: string } {
  const letters = text
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .split("")
  if (!letters.length) return { error: "Type at least one section letter." }
  if (letters.length > MAX_SLOTS)
    return { error: `A song can have up to ${MAX_SLOTS} parts.` }
  // Reuse the existing parts of each section in order, so a part that's
  // being looped keeps looping when the form is retyped around it.
  const spare = new Map<string, Slot[]>()
  for (const slot of song.arrangement)
    spare.set(slot.section, [...(spare.get(slot.section) ?? []), slot])
  const slots: Slot[] = []
  for (const l of letters) {
    const section = song.sections[l.charCodeAt(0) - 65]
    if (!section) return { error: `There's no section ${l}.` }
    slots.push(
      spare.get(section.id)?.shift() ?? { id: uid(), section: section.id }
    )
  }
  return { slots }
}

/** A name for a new section that the song doesn't use yet. */
export function nextSectionName(song: Song) {
  const used = new Set(song.sections.map((s) => s.name))
  return (
    SECTION_NAMES.find((n) => !used.has(n)) ??
    `Section ${sectionLetter(song.sections.length)}`
  )
}

/** "Chorus" → "Chorus 2" (or the next free number). */
export function variantName(song: Song, name: string) {
  const base = name.replace(/\s+\d+$/, "")
  const used = new Set(song.sections.map((s) => s.name))
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`
}

export function makeSection(
  name: string,
  chords: Chord[],
  melody: MelodyNote[] = [],
  drums: DrumSettings = { ...DEFAULT_DRUMS }
): Section {
  return { id: uid(), name, chords, melody, drums }
}

/** A deep copy with fresh ids, so edits to one don't touch the other. */
export function copySection(section: Section, name: string): Section {
  return {
    id: uid(),
    name,
    chords: section.chords.map((c) => ({ ...c, id: uid() })),
    melody: section.melody.map((m) => ({ ...m, id: uid() })),
    drums: structuredClone(section.drums),
  }
}

export function updateSection(
  song: Song,
  id: string,
  patch: Partial<Omit<Section, "id">>
): Song {
  return {
    ...song,
    sections: song.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }
}

/** Add a section to the library and play it at `at` in the form (default: the end). */
export function addSection(song: Song, section: Section, at?: number): Song {
  if (song.sections.length >= MAX_SECTIONS) return song
  const slot = { id: uid(), section: section.id }
  const arrangement = [...song.arrangement]
  if (song.arrangement.length < MAX_SLOTS)
    arrangement.splice(at ?? arrangement.length, 0, slot)
  return { ...song, sections: [...song.sections, section], arrangement }
}

/** Delete a section and every slot that plays it. The last section stays. */
export function removeSection(song: Song, id: string): Song {
  if (song.sections.length <= 1) return song
  const sections = song.sections.filter((s) => s.id !== id)
  let arrangement = song.arrangement.filter((s) => s.section !== id)
  if (!arrangement.length)
    arrangement = [{ id: uid(), section: sections[0].id }]
  return { ...song, sections, arrangement }
}

/** Play a section once more at `at` in the form (default: the end). */
export function addSlot(song: Song, sectionId: string, at?: number): Song {
  if (song.arrangement.length >= MAX_SLOTS) return song
  const arrangement = [...song.arrangement]
  arrangement.splice(at ?? arrangement.length, 0, {
    id: uid(),
    section: sectionId,
  })
  return { ...song, arrangement }
}

/** Repeat a slot straight after itself. */
export function repeatSlot(song: Song, slotId: string): Song {
  const i = song.arrangement.findIndex((s) => s.id === slotId)
  if (i < 0) return song
  return addSlot(song, song.arrangement[i].section, i + 1)
}

/** Take a slot out of the form. The last slot stays. */
export function removeSlot(song: Song, slotId: string): Song {
  if (song.arrangement.length <= 1) return song
  return {
    ...song,
    arrangement: song.arrangement.filter((s) => s.id !== slotId),
  }
}

export function moveSlot(song: Song, from: number, to: number): Song {
  const arrangement = [...song.arrangement]
  const [slot] = arrangement.splice(from, 1)
  if (!slot) return song
  arrangement.splice(to, 0, slot)
  return { ...song, arrangement }
}

/**
 * Turn one slot into a new variation: a copy of its section that only this
 * slot plays, so it can change without touching the other repeats.
 */
export function makeVariation(song: Song, slotId: string): Song {
  if (song.sections.length >= MAX_SECTIONS) return song
  const slot = song.arrangement.find((s) => s.id === slotId)
  const section = song.sections.find((s) => s.id === slot?.section)
  if (!slot || !section) return song
  const copy = copySection(section, variantName(song, section.name))
  return {
    ...song,
    sections: [...song.sections, copy],
    arrangement: song.arrangement.map((s) =>
      s.id === slotId ? { ...s, section: copy.id } : s
    ),
  }
}

/** A song from before sections existed: its one loop becomes section A. */
interface LegacySong {
  chords?: Chord[]
  melody?: MelodyNote[]
  drums?: Partial<DrumSettings>
}

/**
 * Bring a saved song up to date: wrap a pre-sections song into one section,
 * fill in missing drum settings and drop slots that point nowhere.
 */
export function migrateSong(
  saved: Partial<Song> & LegacySong
): Pick<Song, "sections" | "arrangement"> {
  let sections: Section[]
  if (Array.isArray(saved.sections) && saved.sections.length) {
    sections = saved.sections.map((s) => ({
      ...s,
      melody: s.melody ?? [],
      drums: { ...DEFAULT_DRUMS, ...s.drums },
    }))
  } else {
    sections = [
      makeSection("Verse", saved.chords ?? [], saved.melody ?? [], {
        ...DEFAULT_DRUMS,
        ...saved.drums,
      }),
    ]
  }
  const ids = new Set(sections.map((s) => s.id))
  let arrangement = (saved.arrangement ?? []).filter((s) => ids.has(s.section))
  if (!arrangement.length)
    arrangement = [{ id: uid(), section: sections[0].id }]
  return { sections, arrangement }
}
