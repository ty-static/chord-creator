// Minimal Standard MIDI File (format 1) writer — no dependencies.
import type { NoteEvent, TrackName } from "@/lib/arrange"

const PPQ = 480

const TRACK_INFO: Record<
  TrackName,
  { name: string; channel: number; program: number }
> = {
  chords: { name: "Chords", channel: 0, program: 0 }, // Acoustic Grand Piano
  melody: { name: "Melody", channel: 1, program: 0 }, // Acoustic Grand Piano
  drums: { name: "Drums", channel: 9, program: 0 }, // GM percussion channel 10
  bass: { name: "Bass", channel: 2, program: 33 }, // Electric Bass (finger)
}

function vlq(value: number): number[] {
  let v = Math.max(0, Math.round(value))
  const bytes = [v & 0x7f]
  v >>= 7
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return bytes
}

function text(s: string) {
  return Array.from(new TextEncoder().encode(s))
}

function u32(n: number) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

function chunk(type: string, data: number[]) {
  return [...text(type), ...u32(data.length), ...data]
}

interface Raw {
  tick: number
  order: number // note-offs (0) before meta (1) before note-ons (2) at same tick
  bytes: number[]
}

function trackChunk(raw: Raw[]) {
  raw.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const data: number[] = []
  let last = 0
  for (const e of raw) {
    data.push(...vlq(e.tick - last), ...e.bytes)
    last = e.tick
  }
  data.push(0x00, 0xff, 0x2f, 0x00) // end of track
  return chunk("MTrk", data)
}

function metaName(name: string): Raw {
  const t = text(name)
  return { tick: 0, order: 1, bytes: [0xff, 0x03, ...vlq(t.length), ...t] }
}

export interface MidiOptions {
  bpm: number
  title: string
  keySig: { sf: number; minor: boolean }
  /** General MIDI program per track (defaults: piano / piano / finger bass). */
  programs?: Partial<Record<TrackName, number>>
  /** Channel volume (CC7) per track, 0..1. */
  volumes?: Partial<Record<TrackName, number>>
  /** Named points in the song (sections), shown as markers in DAWs. */
  markers?: { beat: number; text: string }[]
  /** Later key signatures (key changes), each from its beat on. */
  keyChanges?: { beat: number; sf: number; minor: boolean }[]
  /** Time signature as [numerator, log2 denominator, clocks, 32nds] (4/4 when unset). */
  timeSig?: number[]
}

const keySigEvent = (
  tick: number,
  sig: { sf: number; minor: boolean }
): Raw => ({
  tick,
  order: 1,
  bytes: [0xff, 0x59, 0x02, sig.sf & 0xff, sig.minor ? 1 : 0],
})

export function buildMidi(events: NoteEvent[], opts: MidiOptions): Uint8Array {
  const tracks: number[][] = []

  // Conductor track: tempo, time signature, key signature.
  const mpq = Math.round(60_000_000 / opts.bpm)
  tracks.push(
    trackChunk([
      metaName(opts.title),
      {
        tick: 0,
        order: 1,
        bytes: [
          0xff,
          0x51,
          0x03,
          (mpq >> 16) & 0xff,
          (mpq >> 8) & 0xff,
          mpq & 0xff,
        ],
      },
      {
        tick: 0,
        order: 1,
        bytes: [0xff, 0x58, 0x04, ...(opts.timeSig ?? [4, 2, 24, 8])],
      },
      ...(opts.markers ?? []).map((m) => {
        const t = text(m.text)
        return {
          tick: Math.round(m.beat * PPQ),
          order: 1,
          bytes: [0xff, 0x06, ...vlq(t.length), ...t],
        }
      }),
      keySigEvent(0, opts.keySig),
      ...(opts.keyChanges ?? []).map((k) =>
        keySigEvent(Math.round(k.beat * PPQ), k)
      ),
    ])
  )

  for (const name of ["chords", "melody", "bass", "drums"] as TrackName[]) {
    const evs = events.filter((e) => e.track === name)
    if (!evs.length) continue
    const { channel } = TRACK_INFO[name]
    const program = opts.programs?.[name] ?? TRACK_INFO[name].program
    const raw: Raw[] = [
      metaName(TRACK_INFO[name].name),
      { tick: 0, order: 1, bytes: [0xc0 | channel, program] },
    ]
    const vol = opts.volumes?.[name]
    if (vol !== undefined)
      raw.push({
        tick: 0,
        order: 1,
        bytes: [
          0xb0 | channel,
          7,
          Math.round(Math.max(0, Math.min(1, vol)) * 127),
        ],
      })
    // A note must end before the same pitch starts again: otherwise the
    // first note-off would cut the second note short (humanize can move
    // a note slightly before the previous one ends).
    const notes = evs
      .map((e) => {
        const on = Math.round(e.start * PPQ)
        const off = Math.max(on + 1, Math.round((e.start + e.duration) * PPQ))
        return { e, on, off }
      })
      .sort((a, b) => a.on - b.on)
    const lastOf = new Map<number, { on: number; off: number }>()
    for (const n of notes) {
      const prev = lastOf.get(n.e.midi)
      if (prev && prev.off > n.on) prev.off = Math.max(prev.on + 1, n.on)
      lastOf.set(n.e.midi, n)
    }
    for (const { e, on, off } of notes) {
      raw.push({
        tick: on,
        order: 2,
        bytes: [0x90 | channel, e.midi & 0x7f, e.velocity & 0x7f],
      })
      raw.push({
        tick: off,
        order: 0,
        bytes: [0x80 | channel, e.midi & 0x7f, 0],
      })
    }
    tracks.push(trackChunk(raw))
  }

  const header = chunk("MThd", [
    0,
    1,
    0,
    tracks.length,
    (PPQ >> 8) & 0xff,
    PPQ & 0xff,
  ])
  return new Uint8Array([...header, ...tracks.flat()])
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  type = "audio/midi"
) {
  const blob = new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
