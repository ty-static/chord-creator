// Reading Standard MIDI Files and turning them into a Chord Creator song.

import {
  DRUM_STEPS,
  DRUM_STEPS_PER_BEAT,
  type DrumPattern,
  type DrumPiece,
  type DrumSettings,
  type StepValue,
  emptyPattern,
} from "@/lib/drums"
import {
  type ChordGuess,
  degreePc,
  detectKey,
  foldDegree,
  guessChord,
  keyFromSignature,
  nearestDegree,
} from "@/lib/harmony"
import {
  type Chord,
  type Key,
  type MelodyNote,
  SCALES,
  type ScaleId,
  STEPS_PER_BEAT,
  melodyBase,
  uid,
} from "@/lib/music"

// ---------------------------------------------------------------- Parsing

export interface RawNote {
  pitch: number
  /** Position and length in beats (quarter notes). */
  start: number
  end: number
  velocity: number
}

export interface MidiPart {
  id: string
  name: string
  channel: number
  program: number | null
  notes: RawNote[]
  isDrums: boolean
}

export interface ParsedMidi {
  bpm: number
  keySig: { sf: number; minor: boolean } | null
  timeSig: [number, number]
  parts: MidiPart[]
  /** Song length in beats. */
  length: number
}

export class MidiParseError extends Error {
  name = "MidiParseError"
}

export function parseMidi(buf: ArrayBuffer): ParsedMidi {
  const data = new Uint8Array(buf)
  let pos = 0
  const u8 = () => {
    if (pos >= data.length) throw new MidiParseError("Unexpected end of file")
    return data[pos++]
  }
  const u16 = () => (u8() << 8) | u8()
  const u32 = () => ((u8() << 24) >>> 0) + (u8() << 16) + (u8() << 8) + u8()
  const str = (n: number) => {
    let s = ""
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8())
    return s
  }
  const vlq = () => {
    let v = 0
    for (let i = 0; i < 4; i++) {
      const b = u8()
      v = (v << 7) | (b & 0x7f)
      if (!(b & 0x80)) return v
    }
    return v
  }

  if (str(4) !== "MThd") throw new MidiParseError("Not a MIDI file")
  const headerLen = u32()
  u16() // format
  const ntrks = u16()
  const division = u16()
  pos += headerLen - 6
  if (division & 0x8000)
    throw new MidiParseError("SMPTE-timed MIDI files aren't supported")
  const ppq = division || 480

  let tempo: number | null = null
  let keySig: ParsedMidi["keySig"] = null
  let timeSig: [number, number] = [4, 4]
  const parts = new Map<string, MidiPart>()
  let length = 0

  for (let t = 0; t < ntrks && pos < data.length; t++) {
    const id = str(4)
    const len = u32()
    const end = pos + len
    if (id !== "MTrk") {
      pos = end
      continue
    }
    let tick = 0
    let running = 0
    let trackName = ""
    const programs: Record<number, number> = {}
    const open = new Map<number, { tick: number; velocity: number }[]>()
    const trackNotes: (RawNote & { channel: number })[] = []

    const close = (ch: number, pitch: number) => {
      const stack = open.get(ch * 128 + pitch)
      const on = stack?.shift()
      if (!on) return
      trackNotes.push({
        channel: ch,
        pitch,
        start: on.tick / ppq,
        end: Math.max(tick, on.tick + 1) / ppq,
        velocity: on.velocity,
      })
    }

    while (pos < end) {
      tick += vlq()
      let status = data[pos]
      if (status & 0x80) pos++
      else status = running // running status
      if (status === 0xff) {
        const type = u8()
        const l = vlq()
        const start = pos
        if (type === 0x51 && l >= 3 && tempo === null)
          tempo = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2]
        else if (type === 0x59 && l >= 2 && !keySig)
          keySig = { sf: (data[pos] << 24) >> 24, minor: data[pos + 1] === 1 }
        else if (type === 0x58 && l >= 2 && tick === 0)
          timeSig = [data[pos], 2 ** data[pos + 1]]
        else if (type === 0x03 && !trackName) trackName = str(l).trim()
        pos = start + l
        continue
      }
      if (status === 0xf0 || status === 0xf7) {
        pos += vlq()
        continue
      }
      running = status
      const kind = status & 0xf0
      const ch = status & 0x0f
      const a = u8()
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : u8()
      if (kind === 0x90 && b > 0) {
        const key = ch * 128 + a
        if (!open.has(key)) open.set(key, [])
        open.get(key)!.push({ tick, velocity: b })
      } else if (kind === 0x80 || (kind === 0x90 && b === 0)) close(ch, a)
      else if (kind === 0xc0) programs[ch] ??= a
    }
    pos = end
    // Close anything left hanging at the end of the track.
    for (const [k, stack] of open)
      for (let i = stack.length; i > 0; i--) close(Math.floor(k / 128), k % 128)

    for (const n of trackNotes) {
      const partId = `${t}:${n.channel}`
      let part = parts.get(partId)
      if (!part) {
        part = {
          id: partId,
          name: trackName,
          channel: n.channel,
          program: programs[n.channel] ?? null,
          notes: [],
          isDrums: n.channel === 9,
        }
        parts.set(partId, part)
      }
      part.notes.push({
        pitch: n.pitch,
        start: n.start,
        end: n.end,
        velocity: n.velocity,
      })
      length = Math.max(length, n.end)
    }
  }

  const list = [...parts.values()].filter((p) => p.notes.length)
  if (!list.length) throw new MidiParseError("No notes found in this file")
  // Name parts sensibly when the file doesn't.
  const byName = new Map<string, number>()
  list.forEach((p, i) => {
    p.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
    p.name ||= p.isDrums ? "Drums" : `Track ${i + 1}`
    const count = (byName.get(p.name) ?? 0) + 1
    byName.set(p.name, count)
    if (count > 1) p.name = `${p.name} (ch ${p.channel + 1})`
  })

  return {
    bpm: tempo ? Math.round(60_000_000 / tempo) : 120,
    keySig,
    timeSig,
    parts: list,
    length,
  }
}

// ---------------------------------------------------------------- Roles

export type PartRole = "melody" | "chords" | "bass" | "drums" | "ignore"

export function partStats(part: MidiPart) {
  const pitches = part.notes.map((n) => n.pitch)
  const avg = pitches.reduce((a, b) => a + b, 0) / pitches.length
  // Average number of notes sounding whenever anything sounds.
  const sounding = part.notes.reduce((s, n) => s + (n.end - n.start), 0)
  let span = 0
  let cursor = -Infinity
  for (const n of part.notes) {
    const start = Math.max(n.start, cursor)
    if (n.end > start) span += n.end - start
    cursor = Math.max(cursor, n.end)
  }
  return {
    count: part.notes.length,
    low: Math.min(...pitches),
    high: Math.max(...pitches),
    avg,
    polyphony: span ? sounding / span : 1,
  }
}

/** Guess what each part is for, from its name, channel and register. */
export function guessRoles(parts: MidiPart[]): Record<string, PartRole> {
  const roles: Record<string, PartRole> = {}
  const pitched: MidiPart[] = []
  for (const p of parts) {
    const n = p.name.toLowerCase()
    if (p.isDrums || /drum|perc|beat|kit/.test(n)) roles[p.id] = "drums"
    else if (/bass/.test(n)) roles[p.id] = "bass"
    else if (/melod|lead|vocal|vox|solo|flute|sax|trumpet|violin/.test(n))
      roles[p.id] = "melody"
    else if (/chord|pad|piano|keys|guitar|organ|string|harm|comp/.test(n))
      roles[p.id] = "chords"
    else pitched.push(p)
  }
  const stats = new Map(pitched.map((p) => [p.id, partStats(p)]))
  for (const p of pitched) {
    const s = stats.get(p.id)!
    roles[p.id] = s.polyphony > 1.4 ? "chords" : "ignore"
  }
  const mono = pitched.filter((p) => roles[p.id] === "ignore")
  const has = (r: PartRole) => Object.values(roles).includes(r)
  mono.sort((a, b) => stats.get(a.id)!.avg - stats.get(b.id)!.avg)
  if (!has("bass") && mono.length && stats.get(mono[0].id)!.avg < 52)
    roles[mono.shift()!.id] = "bass"
  if (!has("melody") && mono.length) roles[mono.pop()!.id] = "melody"
  // Only one melody line can be imported.
  let melodySeen = false
  for (const p of parts)
    if (roles[p.id] === "melody") {
      if (melodySeen) roles[p.id] = "ignore"
      melodySeen = true
    }
  return roles
}

/** Modes of the major scale, by the degree they start on. */
const MODES: (ScaleId | null)[] = [
  "major",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "minor",
  null, // locrian: too rare to guess
]

export function guessKey(
  midi: ParsedMidi,
  roles: Record<string, PartRole>
): Key {
  const pitched = midi.parts.filter(
    (p) => !p.isDrums && roles[p.id] !== "drums" && roles[p.id] !== "ignore"
  )
  let key: Key
  if (midi.keySig) key = keyFromSignature(midi.keySig.sf, midi.keySig.minor)
  else {
    const weights = Array<number>(12).fill(0)
    for (const p of pitched)
      for (const n of p.notes) weights[n.pitch % 12] += n.end - n.start
    key = detectKey(weights)
  }

  // A key signature (or note count) can't tell C major from G Mixolydian or
  // A minor. Songs usually start on their tonic, so let the first chord decide.
  const harmonyParts = pitched.filter((p) => roles[p.id] !== "melody")
  const notes = (harmonyParts.length ? harmonyParts : pitched).flatMap(
    (p) => p.notes
  )
  const bass = pitched
    .filter((p) => roles[p.id] === "bass")
    .flatMap((p) => p.notes)
  const first = Math.min(...notes.map((n) => n.start))
  const last = Math.max(...notes.map((n) => n.end))
  if (!Number.isFinite(first) || !Number.isFinite(last)) return key
  const parent: Key = {
    root: (key.root - SCALES[key.scale].parentOffset + 12) % 12,
    scale: "major",
  }
  const chordIn = (from: number) => {
    const { weights, bassPc } = windowWeights(notes, bass, from, from + 4)
    return guessChord(weights, parent, bassPc)
  }
  const firstBar = Math.floor(first / BEATS_PER_BAR) * BEATS_PER_BAR
  const lastBar = Math.ceil(last / BEATS_PER_BAR - 1) * BEATS_PER_BAR
  const a = chordIn(firstBar)
  const b = chordIn(Math.max(firstBar, lastBar))
  // Only when the song starts and ends on the same chord (strong tonic evidence).
  if (!a || !b || a.degree !== b.degree || a.fit < 0.6) return key
  const mode = MODES[a.degree]
  return mode ? { root: degreePc(parent, a.degree), scale: mode } : key
}

// ---------------------------------------------------------------- Conversion

export const MAX_IMPORT_BARS = 64
const BEATS_PER_BAR = 4

export interface ImportResult {
  chords: Chord[]
  melody: MelodyNote[]
  drums: DrumSettings | null
  bass: boolean
  bars: number
  truncated: boolean
  /** Melody notes that weren't in the key and were moved onto it. */
  snapped: number
}

const GM_DRUMS: Record<number, DrumPiece> = {
  35: "kick",
  36: "kick",
  37: "snare",
  38: "snare",
  40: "snare",
  39: "clap",
  42: "hat",
  44: "hat",
  51: "hat",
  53: "hat",
  59: "hat",
  46: "openhat",
  41: "tom",
  43: "tom",
  45: "tom",
  47: "tom",
  48: "tom",
  50: "tom",
  49: "crash",
  52: "crash",
  55: "crash",
  57: "crash",
}

function windowWeights(
  notes: RawNote[],
  bassNotes: RawNote[],
  from: number,
  to: number
) {
  const weights = Array<number>(12).fill(0)
  let lowest: number | null = null
  const add = (n: RawNote, factor: number) => {
    const overlap = Math.min(n.end, to) - Math.max(n.start, from)
    if (overlap <= 0) return false
    weights[n.pitch % 12] += overlap * factor
    return true
  }
  for (const n of bassNotes)
    if (add(n, 1.5) && (lowest === null || n.pitch < lowest)) lowest = n.pitch
  for (const n of notes)
    if (add(n, 1) && !bassNotes.length && (lowest === null || n.pitch < lowest))
      lowest = n.pitch
  return { weights, bassPc: lowest === null ? null : lowest % 12 }
}

export function midiToSong(
  midi: ParsedMidi,
  roles: Record<string, PartRole>,
  key: Key
): ImportResult {
  const of = (role: PartRole) =>
    midi.parts.filter((p) => roles[p.id] === role).flatMap((p) => p.notes)
  const melodyNotes = of("melody")
  const chordNotes = of("chords")
  const bassNotes = of("bass")
  const drumNotes = of("drums")

  const fullBars = Math.max(1, Math.ceil(midi.length / BEATS_PER_BAR - 0.01))
  const bars = Math.min(fullBars, MAX_IMPORT_BARS)
  const songBeats = bars * BEATS_PER_BAR

  // ---- Chords: one per bar, or two when the harmony clearly changes mid-bar.
  const harmony =
    chordNotes.length || bassNotes.length ? chordNotes : melodyNotes
  const chords: Chord[] = []
  let prev: ChordGuess | null = null
  const push = (g: ChordGuess | null, beats: number) => {
    const guess = g ??
      prev ?? {
        degree: 0,
        type: "triad" as const,
        inversion: 0,
        fit: 0,
        score: 0,
      }
    prev = guess
    const last = chords[chords.length - 1]
    // Merge a repeat of the same chord, up to 8 beats.
    if (
      last &&
      last.degree === guess.degree &&
      last.type === guess.type &&
      last.inversion === guess.inversion &&
      last.beats === beats &&
      last.beats + beats <= 8 &&
      [1, 2, 4, 8].includes(last.beats + beats)
    ) {
      last.beats += beats
      return
    }
    chords.push({
      id: uid(),
      degree: guess.degree,
      type: guess.type,
      inversion: guess.inversion,
      beats,
    })
  }
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * BEATS_PER_BAR
    const whole = windowWeights(harmony, bassNotes, b0, b0 + 4)
    const g = guessChord(whole.weights, key, whole.bassPc)
    const h1w = windowWeights(harmony, bassNotes, b0, b0 + 2)
    const h2w = windowWeights(harmony, bassNotes, b0 + 2, b0 + 4)
    const h1 = guessChord(h1w.weights, key, h1w.bassPc)
    const h2 = guessChord(h2w.weights, key, h2w.bassPc)
    const split =
      g &&
      h1 &&
      h2 &&
      h1.degree !== h2.degree &&
      (h1.fit + h2.fit) / 2 > g.fit + 0.12
    if (split) {
      push(h1, 2)
      push(h2, 2)
    } else push(g, 4)
  }

  // ---- Melody: quantise to eighth notes, keep the top line, map to the scale.
  const totalSteps = songBeats * STEPS_PER_BEAT
  const quantised = melodyNotes
    .map((n) => {
      const start = Math.round(n.start * STEPS_PER_BEAT)
      const end = Math.max(start + 1, Math.round(n.end * STEPS_PER_BEAT))
      return { start, end, pitch: n.pitch }
    })
    .filter((n) => n.start < totalSteps)
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch)
  const top = quantised.filter(
    (n, i) => i === 0 || n.start !== quantised[i - 1].start
  )
  // Shift whole octaves so the line sits in the middle of the grid.
  let octave = 0
  if (top.length) {
    const pitches = top.map((n) => n.pitch).sort((a, b) => a - b)
    const median = pitches[Math.floor(pitches.length / 2)]
    octave = Math.round((melodyBase(key) + 9 - median) / 12) * 12
  }
  let snapped = 0
  const melody: MelodyNote[] = top.map((n, i) => {
    const next = i + 1 < top.length ? top[i + 1].start : totalSteps
    const pitch = n.pitch + octave
    const degree = nearestDegree(pitch, key)
    if (degreePc(key, degree) !== pitch % 12) snapped++
    return {
      id: uid(),
      start: n.start,
      length: Math.max(1, Math.min(n.end, next, totalSteps) - n.start),
      degree: foldDegree(degree),
    }
  })

  // ---- Drums: the most common one-bar pattern.
  let drums: DrumSettings | null = null
  if (drumNotes.length) {
    const counts: Record<DrumPiece, { hits: number; vel: number }[]> =
      Object.fromEntries(
        Object.keys(emptyPattern()).map((k) => [
          k,
          Array.from({ length: DRUM_STEPS }, () => ({ hits: 0, vel: 0 })),
        ])
      ) as Record<DrumPiece, { hits: number; vel: number }[]>
    const barsWithDrums = new Set<number>()
    let crashAtStart = false
    for (const n of drumNotes) {
      const piece = GM_DRUMS[n.pitch]
      if (!piece || n.start >= songBeats) continue
      const step = Math.round(n.start * DRUM_STEPS_PER_BEAT)
      const bar = Math.floor(step / DRUM_STEPS)
      if (piece === "crash" && step === 0) crashAtStart = true
      barsWithDrums.add(bar)
      const c = counts[piece][step % DRUM_STEPS]
      c.hits++
      c.vel += n.velocity
    }
    const need = Math.max(1, Math.ceil(barsWithDrums.size * 0.4))
    const pattern = emptyPattern()
    for (const piece of Object.keys(pattern) as DrumPiece[]) {
      // Accents are hits clearly louder than this drum's usual velocity.
      const vels = drumNotes
        .filter((n) => GM_DRUMS[n.pitch] === piece)
        .map((n) => n.velocity)
        .sort((a, b) => a - b)
      const quiet = vels[Math.floor(vels.length / 4)] ?? 100
      pattern[piece] = counts[piece].map((c) =>
        c.hits >= need
          ? c.vel / c.hits >= Math.min(quiet + 10, 112)
            ? 2
            : 1
          : 0
      ) as StepValue[]
    }
    // A crash on beat 1 of only the first bar is a "crash at start", not part of the loop.
    const crashOnlyAtStart =
      crashAtStart && counts.crash[0].hits < need ? true : false
    drums = {
      enabled: true,
      pattern: pattern as DrumPattern,
      fill: false,
      crashAtStart: crashOnlyAtStart,
    }
  }

  return {
    chords,
    melody,
    drums,
    bass: bassNotes.length > 0,
    bars,
    truncated: fullBars > bars,
    snapped,
  }
}
