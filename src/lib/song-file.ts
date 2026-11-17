// Songs outside the editor: the default song, checking songs that come from
// storage, files or links, song files (.json) and share links.

import {
  type ChordStyle,
  MAX_ENERGY,
  MAX_TRANSPOSE,
  MIN_ENERGY,
  type Section,
  type Slot,
  type Song,
  TRACK_NAMES,
} from "@/lib/arrange"
import { DEFAULT_MIX, type Mix } from "@/lib/audio-engine"
import {
  DEFAULT_DRUMS,
  DRUM_PIECES,
  DRUM_STEPS,
  type DrumPattern,
  type DrumSettings,
  type StepValue,
  emptyPattern,
  presetPattern,
} from "@/lib/drums"
import {
  DEFAULT_INSTRUMENTS,
  INSTRUMENTS,
  type TrackInstruments,
} from "@/lib/instruments"
import {
  type Chord,
  type ChordType,
  MELODY_RANGE,
  type MelodyNote,
  PRESETS,
  SCALES,
  type ScaleId,
  chordsFromPreset,
  generateMelody,
  uid,
} from "@/lib/music"
import { MAX_SECTIONS, MAX_SLOTS, makeSection } from "@/lib/sections"

export const DEFAULT_TITLE = "Untitled song"
export const MAX_TITLE = 60
const MIN_BPM = 50
const MAX_BPM = 200
const MAX_CHORDS = 64
const MAX_NOTES = 1024

/** The song a first-time visitor starts with. */
export function defaultSong(): Song {
  const chords = chordsFromPreset(PRESETS[0])
  const verse = makeSection(
    "Verse",
    chords,
    generateMelody(chords, { density: 0.55, seed: 7 }),
    { ...DEFAULT_DRUMS, enabled: true, pattern: presetPattern("pop") }
  )
  return {
    title: "My first song",
    key: { root: 0, scale: "major" },
    bpm: 100,
    sections: [verse],
    arrangement: [{ id: uid(), section: verse.id }],
    chordStyle: "block",
    bass: true,
    instruments: DEFAULT_INSTRUMENTS,
    reverb: 0.25,
    mix: structuredClone(DEFAULT_MIX),
    voiceLeading: false,
  }
}

export class SongFileError extends Error {}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj =>
  typeof x === "object" && x !== null && !Array.isArray(x)
const num = (x: unknown, fallback: number, lo: number, hi: number) =>
  typeof x === "number" && Number.isFinite(x)
    ? Math.min(hi, Math.max(lo, x))
    : fallback
const int = (x: unknown, fallback: number, lo: number, hi: number) =>
  Math.round(num(x, fallback, lo, hi))
const bool = (x: unknown, fallback: boolean) =>
  typeof x === "boolean" ? x : fallback
const str = (x: unknown, fallback: string, max: number) =>
  typeof x === "string" && x.trim() ? x.trim().slice(0, max) : fallback
const id = (x: unknown) =>
  typeof x === "string" && /^[\w-]{1,40}$/.test(x) ? x : uid()

const CHORD_TYPES: ChordType[] = ["triad", "seventh", "ninth", "sus2", "sus4"]
const STYLES: ChordStyle[] = ["block", "pulse", "arpeggio"]

function chord(x: unknown): Chord | null {
  if (!isObj(x) || typeof x.degree !== "number") return null
  return {
    id: id(x.id),
    degree: int(x.degree, 0, 0, 6),
    type: CHORD_TYPES.includes(x.type as ChordType)
      ? (x.type as ChordType)
      : "triad",
    inversion: int(x.inversion, 0, 0, 3),
    beats: int(x.beats, 4, 1, 32),
  }
}

function note(x: unknown): MelodyNote | null {
  if (!isObj(x) || typeof x.start !== "number" || typeof x.degree !== "number")
    return null
  return {
    id: id(x.id),
    start: int(x.start, 0, 0, 100_000),
    length: int(x.length, 1, 1, 256),
    degree: int(x.degree, 0, 0, MELODY_RANGE - 1),
    ...(x.locked === true ? { locked: true } : {}),
  }
}

function pattern(x: unknown): DrumPattern {
  const out = emptyPattern()
  if (!isObj(x)) return out
  for (const { id: piece } of DRUM_PIECES) {
    const row = x[piece]
    if (!Array.isArray(row)) continue
    out[piece] = Array.from(
      { length: DRUM_STEPS },
      (_, i) => int(row[i], 0, 0, 2) as StepValue
    )
  }
  return out
}

function drums(x: unknown): DrumSettings {
  if (!isObj(x)) return { ...DEFAULT_DRUMS }
  return {
    enabled: bool(x.enabled, DEFAULT_DRUMS.enabled),
    pattern: isObj(x.pattern) ? pattern(x.pattern) : DEFAULT_DRUMS.pattern,
    fill: bool(x.fill, DEFAULT_DRUMS.fill),
    crashAtStart: bool(x.crashAtStart, DEFAULT_DRUMS.crashAtStart),
  }
}

function section(x: unknown, index: number): Section | null {
  if (!isObj(x)) return null
  const chords = (Array.isArray(x.chords) ? x.chords : [])
    .slice(0, MAX_CHORDS)
    .map(chord)
    .filter((c): c is Chord => !!c)
  const steps = chords.reduce((n, c) => n + c.beats, 0) * 2
  // Notes must fit the section's chords and must not overlap each other.
  const melody = (Array.isArray(x.melody) ? x.melody : [])
    .slice(0, MAX_NOTES)
    .map(note)
    .filter((n): n is MelodyNote => !!n && n.start < steps)
    .sort((a, b) => a.start - b.start)
  const clean: MelodyNote[] = []
  for (const n of melody) {
    const prev = clean[clean.length - 1]
    if (prev && prev.start + prev.length > n.start) continue
    clean.push({ ...n, length: Math.min(n.length, steps - n.start) })
  }
  const tacet = Array.isArray(x.tacet)
    ? TRACK_NAMES.filter((t) => (x.tacet as unknown[]).includes(t))
    : []
  const energy = num(x.energy, 1, MIN_ENERGY, MAX_ENERGY)
  const transpose = int(x.transpose, 0, -MAX_TRANSPOSE, MAX_TRANSPOSE)
  return {
    id: id(x.id),
    name: str(x.name, `Section ${index + 1}`, 24),
    chords,
    melody: clean,
    drums: drums(x.drums),
    // Only kept when they differ from the song, so files stay small.
    ...(tacet.length ? { tacet } : {}),
    ...(STYLES.includes(x.chordStyle as ChordStyle)
      ? { chordStyle: x.chordStyle as ChordStyle }
      : {}),
    ...(energy !== 1 ? { energy: Math.round(energy * 100) / 100 } : {}),
    ...(transpose ? { transpose } : {}),
  }
}

/** A 0..1 feel amount, left out when it's 0. */
function feel(name: "swing" | "humanize", x: unknown) {
  const v = Math.round(num(x, 0, 0, 1) * 100) / 100
  return v ? { [name]: v } : {}
}

function mix(x: unknown): Mix {
  const out = structuredClone(DEFAULT_MIX)
  if (!isObj(x)) return out
  for (const t of TRACK_NAMES) {
    const m = x[t]
    if (!isObj(m)) continue
    out[t] = {
      volume: num(m.volume, out[t].volume, 0, 1),
      mute: bool(m.mute, false),
      solo: bool(m.solo, false),
    }
  }
  return out
}

function instruments(x: unknown): TrackInstruments {
  const out = { ...DEFAULT_INSTRUMENTS }
  if (!isObj(x)) return out
  for (const t of TRACK_NAMES) {
    const v = x[t]
    if (typeof v === "string" && INSTRUMENTS[v]) out[t] = v
  }
  return out
}

/**
 * Turn anything that claims to be a song (saved by an older version of the
 * app, read from a file or a link) into a valid one. Unknown fields are
 * dropped, numbers are clamped and broken parts are left out.
 * Throws SongFileError if there's no music in it at all.
 */
export function normalizeSong(raw: unknown): Song {
  if (!isObj(raw)) throw new SongFileError("This isn't a Chord Creator song.")

  let sections: Section[]
  if (Array.isArray(raw.sections)) {
    sections = raw.sections
      .slice(0, MAX_SECTIONS)
      .map(section)
      .filter((s): s is Section => !!s)
  } else if (Array.isArray(raw.chords)) {
    // Saved before sections existed: one loop at the top level.
    const s = section(
      {
        name: "Verse",
        chords: raw.chords,
        melody: raw.melody,
        drums: raw.drums,
      },
      0
    )
    sections = s ? [s] : []
  } else sections = []
  if (!sections.length || sections.every((s) => !s.chords.length))
    throw new SongFileError("This song has no chords in it.")

  // Section ids must be unique for the form to point at them.
  const seen = new Set<string>()
  for (const s of sections) {
    if (seen.has(s.id)) s.id = uid()
    seen.add(s.id)
  }

  const ids = new Set(sections.map((s) => s.id))
  let arrangement: Slot[] = (
    Array.isArray(raw.arrangement) ? raw.arrangement : []
  )
    .slice(0, MAX_SLOTS)
    .filter((s): s is Obj => isObj(s) && ids.has(s.section as string))
    .map((s) => ({ id: uid(), section: s.section as string }))
  if (!arrangement.length)
    arrangement = [{ id: uid(), section: sections[0].id }]

  const key = isObj(raw.key) ? raw.key : {}
  return {
    title: str(raw.title, DEFAULT_TITLE, MAX_TITLE),
    key: {
      root: int(key.root, 0, 0, 11),
      scale: (key.scale as string) in SCALES ? (key.scale as ScaleId) : "major",
    },
    bpm: int(raw.bpm, 100, MIN_BPM, MAX_BPM),
    sections,
    arrangement,
    chordStyle: STYLES.includes(raw.chordStyle as ChordStyle)
      ? (raw.chordStyle as ChordStyle)
      : "block",
    bass: bool(raw.bass, true),
    instruments: instruments(raw.instruments),
    reverb: num(raw.reverb, 0.25, 0, 1),
    mix: mix(raw.mix),
    voiceLeading: bool(raw.voiceLeading, false),
    ...feel("swing", raw.swing),
    ...feel("humanize", raw.humanize),
  }
}

// ---- Song files -----------------------------------------------------------

const APP = "chord-creator"
const FILE_VERSION = 1

/** A song file: one song, or a backup of many. */
export function songFile(songs: Song[]) {
  const body =
    songs.length === 1
      ? { app: APP, version: FILE_VERSION, song: songs[0] }
      : { app: APP, version: FILE_VERSION, songs }
  return new TextEncoder().encode(JSON.stringify(body, null, 1))
}

/** Read a song file (or a bare song object). Returns the songs in it. */
export function parseSongFile(text: string): Song[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new SongFileError("The file isn't valid JSON.")
  }
  if (isObj(data) && data.app === APP) {
    if (typeof data.version === "number" && data.version > FILE_VERSION)
      throw new SongFileError(
        "This file was made by a newer version of Chord Creator. Reload the page and try again."
      )
    if (Array.isArray(data.songs)) {
      const songs: Song[] = []
      for (const s of data.songs) {
        try {
          songs.push(normalizeSong(s))
        } catch {
          /* skip broken songs in a backup */
        }
      }
      if (!songs.length)
        throw new SongFileError("There are no songs in this backup.")
      return songs
    }
    return [normalizeSong(data.song)]
  }
  return [normalizeSong(data)]
}

/** A file name from a song title, e.g. "Late Night Drive" → "late-night-drive". */
export function fileSlug(title: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "song"
  )
}

// ---- Share links ----------------------------------------------------------

export const SHARE_PARAM = "song"

/** A song without the ids the editor uses, which a link doesn't need. */
function compact(song: Song) {
  const index = new Map(song.sections.map((s, i) => [s.id, i]))
  return {
    ...song,
    sections: song.sections.map((s) => ({
      name: s.name,
      tacet: s.tacet,
      chordStyle: s.chordStyle,
      energy: s.energy,
      transpose: s.transpose,
      drums: s.drums,
      ...notesOf(s),
    })),
    arrangement: song.arrangement.map((s) => index.get(s.section) ?? 0),
  }
}

function notesOf({ chords, melody }: Section) {
  return {
    chords: chords.map((c) => ({
      degree: c.degree,
      type: c.type,
      inversion: c.inversion,
      beats: c.beats,
    })),
    melody: melody.map((n) => ({
      start: n.start,
      length: n.length,
      degree: n.degree,
      ...(n.locked ? { locked: true } : {}),
    })),
  }
}

/** Whether two songs are the same apart from ids (e.g. a backup restored twice). */
export const sameSong = (a: Song, b: Song) =>
  JSON.stringify(compact(normalizeSong(a))) ===
  JSON.stringify(compact(normalizeSong(b)))

function expand(data: unknown): unknown {
  if (!isObj(data) || !Array.isArray(data.sections)) return data
  const sections = data.sections.map((s) =>
    isObj(s) ? { ...s, id: uid() } : s
  ) as Obj[]
  const arrangement = Array.isArray(data.arrangement)
    ? data.arrangement.map((i) => ({
        section: typeof i === "number" ? sections[i]?.id : undefined,
      }))
    : []
  return { ...data, sections, arrangement }
}

const toBase64Url = (bytes: Uint8Array) => {
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const fromBase64Url = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** The song packed into a URL-safe string (compressed JSON). */
export async function encodeShare(song: Song) {
  const json = new TextEncoder().encode(JSON.stringify(compact(song)))
  return toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))
}

/** Unpack a song from a share link. Throws SongFileError if it's broken. */
export async function decodeShare(code: string): Promise<Song> {
  let data: unknown
  try {
    const bytes = await pipe(
      fromBase64Url(code),
      new DecompressionStream("deflate-raw")
    )
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new SongFileError(
      "This share link is broken. It may have been cut off when it was copied."
    )
  }
  return normalizeSong(expand(data))
}

/** A link that opens this song in the app. */
export async function shareUrl(song: Song, base: string) {
  const url = new URL(base)
  url.search = ""
  url.hash = `${SHARE_PARAM}=${await encodeShare(song)}`
  return url.toString()
}

/** The share code in a URL hash, if there is one. */
export function shareCode(hash: string) {
  const m = new RegExp(`(?:^#|&)${SHARE_PARAM}=([\\w-]+)`).exec(hash)
  return m?.[1] ?? null
}
