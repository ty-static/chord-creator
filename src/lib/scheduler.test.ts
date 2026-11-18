import { describe, expect, it } from "vitest"

import type { NoteEvent, TrackName } from "@/lib/arrange"
import type { PlayNote } from "@/lib/audio-engine"
import { DEFAULT_INSTRUMENTS } from "@/lib/instruments"
import {
  CLICK_NOTE,
  EDIT_LATENCY,
  LOOKAHEAD,
  type PlaySettings,
  START_DELAY,
  type Transport,
  advance,
  beatAt,
  createTransport,
  replan,
} from "@/lib/scheduler"

interface Played extends PlayNote {
  track: TrackName
  cancelled: boolean
}

/** Fake instruments that record every note, and whether it was cancelled. */
function recorder() {
  const played: Played[] = []
  const voice = (track: TrackName) => ({
    start: (n: PlayNote) => {
      const rec: Played = { ...n, track, cancelled: false }
      played.push(rec)
      return () => {
        rec.cancelled = true
      }
    },
  })
  const voices = {
    chords: voice("chords"),
    melody: voice("melody"),
    bass: voice("bass"),
    drums: voice("drums"),
  }
  /** Notes that will actually sound. */
  const heard = () =>
    played
      .filter((p) => !p.cancelled)
      .sort((a, b) => a.time - b.time || a.note - b.note)
  return { voices, played, heard }
}

const ev = (
  midi: number,
  start: number,
  duration = 1,
  track: TrackName = "melody"
): NoteEvent => ({
  midi,
  start,
  duration,
  velocity: 100,
  track,
})

/** One note on every beat of a 4-beat song: 60, 61, 62, 63. */
const scale = [0, 1, 2, 3].map((b) => ev(60 + b, b))

const settings = (patch: Partial<PlaySettings> = {}): PlaySettings => ({
  events: scale,
  bpm: 120, // half a second per beat
  end: 4,
  loop: false,
  instruments: DEFAULT_INSTRUMENTS,
  ...patch,
})

/** Run the transport like the player's timer does, every 100 ms, until `until`. */
function run(tr: Transport, from: number, until: number) {
  let ended = false
  for (let now = from; now <= until + 1e-9 && !ended; now += 0.1)
    ended = advance(tr, now)
  return ended
}

const T0 = 10 // audio clock when Play is pressed
const first = T0 + START_DELAY

describe("scheduler: plain playback", () => {
  it("plays every note once, at the right time, then ends", () => {
    const rec = recorder()
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings(),
      from: 0,
      now: T0,
    })
    expect(run(tr, T0, T0 + 1)).toBe(false) // still going
    const ended = run(tr, T0 + 1, T0 + 3)
    expect(ended).toBe(true)
    expect(
      rec.heard().map((n) => [n.note, +(n.time - first).toFixed(6), n.duration])
    ).toEqual([
      [60, 0, 0.5],
      [61, 0.5, 0.5],
      [62, 1, 0.5],
      [63, 1.5, 0.5],
    ])
  })

  it("only schedules up to the look-ahead window", () => {
    const rec = recorder()
    const long = Array.from({ length: 64 }, (_, i) => ev(60, i))
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings({ events: long, end: 64 }),
      from: 0,
      now: T0,
    })
    advance(tr, T0)
    for (const n of rec.played)
      expect(n.time).toBeLessThan(T0 + LOOKAHEAD + 0.5)
    expect(rec.played.length).toBeLessThan(10)
  })

  it("starts mid-song, including notes already sounding there", () => {
    const rec = recorder()
    const held = [ev(48, 0, 4, "chords"), ...scale]
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings({ events: held }),
      from: 2,
      now: T0,
    })
    run(tr, T0, T0 + 2)
    expect(
      rec.heard().map((n) => [n.note, +(n.time - first).toFixed(6), n.duration])
    ).toEqual([
      [48, 0, 1], // the held chord, for its remaining two beats
      [62, 0, 0.5],
      [63, 0.5, 0.5],
    ])
  })

  it("tracks the playhead", () => {
    const rec = recorder()
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings(),
      from: 1,
      now: T0,
    })
    expect(beatAt(tr, first)).toBe(1)
    expect(beatAt(tr, first + 0.75)).toBeCloseTo(2.5)
  })
})

describe("scheduler: looping", () => {
  it("repeats the whole song seamlessly", () => {
    const rec = recorder()
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings({ loop: true }),
      from: 0,
      now: T0,
    })
    expect(run(tr, T0, T0 + 6)).toBe(false) // never ends
    const times = rec.heard().map((n) => +(n.time - first).toFixed(6))
    // A note every half second, with no gap or doubling at the loop point.
    times.slice(0, 12).forEach((t, i) => expect(t).toBeCloseTo(i * 0.5))
    expect(
      rec
        .heard()
        .slice(0, 8)
        .map((n) => n.note)
    ).toEqual([60, 61, 62, 63, 60, 61, 62, 63])
  })

  it("loops just the chosen section, clipping notes at the loop end", () => {
    const rec = recorder()
    const events = [ev(60, 0), ev(61, 1, 2), ev(62, 2), ev(63, 3)]
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings({ events, loop: true, loopStart: 1, loopEnd: 3 }),
      from: 0,
      now: T0,
    })
    run(tr, T0, T0 + 3)
    const heard = rec.heard()
    expect(heard.some((n) => n.note === 60 || n.note === 63)).toBe(false)
    expect(
      heard.slice(0, 4).map((n) => [n.note, +(n.time - first).toFixed(6)])
    ).toEqual([
      [61, 0],
      [62, 0.5],
      [61, 1],
      [62, 1.5],
    ])
    // A note spanning the loop end is cut there, not left hanging.
    expect(heard.find((n) => n.note === 61)!.duration).toBeCloseTo(1)
  })

  it("re-sounds a note that is held across the loop start", () => {
    const rec = recorder()
    const events = [ev(48, 0, 4, "chords"), ev(60, 2)]
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings({ events, loop: true, loopStart: 2, loopEnd: 4 }),
      from: 2,
      now: T0,
    })
    run(tr, T0, T0 + 2)
    // Once per loop pass (every second), however far ahead it has scheduled.
    const chords = rec.heard().filter((n) => n.note === 48)
    expect(chords.length).toBeGreaterThanOrEqual(3)
    chords.forEach((n, i) => expect(n.time - first).toBeCloseTo(i))
    for (const c of chords) expect(c.duration).toBeCloseTo(1)
  })

  it("moves the playhead back at the loop point", () => {
    const rec = recorder()
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings({ loop: true }),
      from: 0,
      now: T0,
    })
    run(tr, T0, T0 + 2.5)
    expect(beatAt(tr, first + 2.25)).toBeCloseTo(0.5)
  })
})

describe("scheduler: editing while playing", () => {
  const start = (s: PlaySettings) => {
    const rec = recorder()
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: s,
      from: 0,
      now: T0,
    })
    return { rec, tr }
  }

  it("cancels notes that haven't started and plays the new ones on the same grid", () => {
    const { rec, tr } = start(settings({ loop: true }))
    run(tr, T0, T0 + 0.6) // ~beat 1
    const editAt = T0 + 0.6
    const old = [...rec.played]
    tr.settings = {
      ...tr.settings,
      events: scale.map((e) => ({ ...e, midi: e.midi + 12 })),
    }
    replan(tr, editAt)
    run(tr, editAt, editAt + 3)

    const t = editAt + EDIT_LATENCY
    // Old notes that already started are left alone; later ones are cancelled.
    expect(old.some((n) => n.time >= t)).toBe(true)
    for (const n of old) expect(n.cancelled).toBe(n.time >= t)
    const after = rec.heard().filter((n) => n.time >= t)
    expect(after.every((n) => n.note >= 72)).toBe(true)
    // Still exactly on the half-second grid, with no doubled notes.
    const times = rec.heard().map((n) => n.time - first)
    times.forEach((x, i) => expect(x).toBeCloseTo(i * 0.5))
  })

  it("keeps the playhead continuous across an edit", () => {
    const { tr } = start(settings({ loop: true }))
    run(tr, T0, T0 + 1)
    const before = beatAt(tr, T0 + 1 + EDIT_LATENCY)
    replan(tr, T0 + 1)
    expect(beatAt(tr, T0 + 1 + EDIT_LATENCY)).toBeCloseTo(before)
  })

  it("changes tempo from the edit point on", () => {
    const { rec, tr } = start(settings({ loop: true }))
    run(tr, T0, T0 + 0.6)
    const t = T0 + 0.6 + EDIT_LATENCY
    const beatThen = beatAt(tr, t)
    tr.settings = { ...tr.settings, bpm: 60 } // a second per beat
    replan(tr, T0 + 0.6)
    // The playhead now moves a beat per second from the edit point.
    expect(beatAt(tr, t + 0.5)).toBeCloseTo(beatThen + 0.5)
    run(tr, T0 + 0.6, T0 + 5)
    const later = rec.heard().filter((n) => n.time >= t)
    // The next beat lands where the new tempo puts it.
    const nextBeat = Math.ceil(beatThen)
    expect(later[0].time).toBeCloseTo(t + (nextBeat - beatThen) * 1)
    for (let i = 1; i < 4; i++)
      expect(later[i].time - later[i - 1].time).toBeCloseTo(1)
  })

  it("wraps to the loop start when the song gets shorter than the playhead", () => {
    const { rec, tr } = start(
      settings({
        loop: true,
        end: 8,
        events: [
          ...scale,
          ...scale.map((e) => ({
            ...e,
            start: e.start + 4,
            midi: e.midi + 10,
          })),
        ],
      })
    )
    run(tr, T0, T0 + 2.6) // into the second bar
    expect(beatAt(tr, T0 + 2.6)).toBeGreaterThan(4)
    tr.settings = { ...tr.settings, end: 4, events: scale }
    replan(tr, T0 + 2.6)
    expect(run(tr, T0 + 2.6, T0 + 5)).toBe(false)
    const t = T0 + 2.6 + EDIT_LATENCY
    const after = rec.heard().filter((n) => n.time >= t)
    expect(after.slice(0, 4).map((n) => n.note)).toEqual([60, 61, 62, 63])
    expect(after[0].time).toBeCloseTo(t)
  })

  it("ends when the song gets shorter than the playhead and isn't looping", () => {
    const { tr } = start(settings({ end: 8, events: scale }))
    run(tr, T0, T0 + 2.6)
    tr.settings = { ...tr.settings, end: 4 }
    replan(tr, T0 + 2.6)
    expect(advance(tr, T0 + 2.6 + EDIT_LATENCY)).toBe(true)
  })

  it("applies a new loop range immediately", () => {
    const { rec, tr } = start(
      settings({
        loop: true,
        end: 8,
        events: Array.from({ length: 8 }, (_, i) => ev(60 + i, i)),
      })
    )
    run(tr, T0, T0 + 0.4)
    tr.settings = { ...tr.settings, loopStart: 4, loopEnd: 6 }
    replan(tr, T0 + 0.4)
    run(tr, T0 + 0.4, T0 + 3)
    const after = rec.heard().filter((n) => n.time >= T0 + 0.4 + EDIT_LATENCY)
    expect(after.slice(0, 4).map((n) => n.note)).toEqual([64, 65, 64, 65])
  })

  it("can be edited many times in a row without doubling notes", () => {
    const { rec, tr } = start(settings({ loop: true }))
    let now = T0
    for (let i = 0; i < 30; i++) {
      run(tr, now, now + 0.13)
      now += 0.13
      tr.settings = { ...tr.settings }
      replan(tr, now)
    }
    run(tr, now, now + 2)
    const times = rec.heard().map((n) => +(n.time - first).toFixed(6))
    expect(new Set(times).size).toBe(times.length)
    times.forEach((x, i) => expect(x).toBeCloseTo(i * 0.5))
  })
})

describe("scheduler: count-in", () => {
  const countIn = { beats: 4, clicks: [0, 1, 2, 3] }

  it("clicks a bar, then starts the music", () => {
    const rec = recorder()
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings(),
      from: 0,
      now: T0,
      countIn,
    })
    run(tr, T0, T0 + 6)
    const heard = rec.heard()
    const clicks = heard.filter((n) => n.note === CLICK_NOTE)
    expect(clicks.map((n) => +(n.time - first).toFixed(6))).toEqual([
      0, 0.5, 1, 1.5,
    ])
    expect(clicks[0].velocity).toBeGreaterThan(clicks[1].velocity)
    // The first note comes a bar (2 s at 120 BPM) after the first click.
    const notes = heard.filter((n) => n.track === "melody")
    expect(+(notes[0].time - first).toFixed(6)).toBe(2)
    // The playhead waits at the start until then.
    expect(beatAt(tr, first + 1)).toBe(0)
  })

  it("keeps the clicks and the start time through an edit", () => {
    const rec = recorder()
    const tr = createTransport({
      token: 1,
      voices: rec.voices,
      settings: settings(),
      from: 0,
      now: T0,
      countIn,
    })
    advance(tr, T0)
    tr.settings = settings({ events: scale.map((e) => ({ ...e, midi: 72 })) })
    replan(tr, T0 + 0.3)
    run(tr, T0 + 0.3, T0 + 6)
    const heard = rec.heard()
    expect(heard.filter((n) => n.note === CLICK_NOTE)).toHaveLength(4)
    const notes = heard.filter((n) => n.track === "melody")
    expect(notes.map((n) => n.note)).toEqual([72, 72, 72, 72])
    expect(+(notes[0].time - first).toFixed(6)).toBe(2)
  })
})
