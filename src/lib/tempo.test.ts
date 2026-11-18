import { describe, expect, it } from "vitest"

import { buildEvents, layout } from "@/lib/arrange"
import { EXAMPLES } from "@/lib/examples"
import { DEFAULT_INSTRUMENTS } from "@/lib/instruments"
import { buildMidi } from "@/lib/midi"
import { renderSeconds } from "@/lib/render"
import { START_DELAY, advance, beatAt, createTransport } from "@/lib/scheduler"
import { addOutro } from "@/lib/sections"
import { normalizeSong } from "@/lib/song-file"
import {
  SLOW_DOWN_TO,
  bpmAt,
  secondsAt,
  steadyTempo,
  tempoMap,
} from "@/lib/tempo"

const CHORDS = { chords: true, melody: false, bass: false, drums: false }
const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()

/** The pop example with one section at a tempo (percent of the song's). */
function withTempo(pct: number, slowDown = false) {
  const song = pop()
  const id = song.arrangement[1].section
  song.sections = song.sections.map((s) =>
    s.id === id ? { ...s, tempo: pct, slowDown } : s
  )
  return { song, id }
}

describe("tempo map", () => {
  it("is one tempo for a song without changes", () => {
    const song = pop()
    expect(tempoMap(song)).toEqual([{ beat: 0, bpm: song.bpm }])
  })

  it("changes tempo wherever a section with its own tempo plays", () => {
    const { song, id } = withTempo(50)
    const map = tempoMap(song)
    for (const p of layout(song)) {
      const want = p.section.id === id ? song.bpm / 2 : song.bpm
      expect(bpmAt(map, p.start)).toBe(want)
      expect(bpmAt(map, p.start + p.beats - 0.5)).toBe(want)
    }
  })

  it("slows down over the last bars of a section", () => {
    const { song } = withTempo(100, true)
    const p = layout(song)[1]
    const map = tempoMap(song)
    const end = p.start + p.beats
    expect(bpmAt(map, end - 8.5)).toBe(song.bpm) // two bars of 4/4 at most
    const ramp = map.filter((t) => t.beat >= end - 8 && t.beat < end)
    expect(ramp.length).toBeGreaterThan(4)
    for (let i = 1; i < ramp.length; i++)
      expect(ramp[i].bpm).toBeLessThan(ramp[i - 1].bpm)
    expect(ramp.at(-1)!.bpm).toBeCloseTo(song.bpm * SLOW_DOWN_TO, 0)
    // And the next section is back at the song's tempo.
    expect(bpmAt(map, end)).toBe(song.bpm)
  })

  it("adds up the seconds across tempo changes", () => {
    const map = [
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 60 },
    ]
    expect(secondsAt(map, 2)).toBeCloseTo(1)
    expect(secondsAt(map, 4)).toBeCloseTo(2)
    expect(secondsAt(map, 6)).toBeCloseTo(4)
    expect(secondsAt(steadyTempo(100), 100)).toBeCloseTo(60)
  })

  it("is saved with the section", () => {
    const { song, id } = withTempo(75, true)
    const back = normalizeSong(JSON.parse(JSON.stringify(song)))
    const s = back.sections.find((x) => x.id === id)!
    expect(s.tempo).toBe(75)
    expect(s.slowDown).toBe(true)
    const odd = normalizeSong({
      ...song,
      sections: song.sections.map((x) => ({ ...x, tempo: 1000 })),
    })
    expect(odd.sections[0].tempo).toBe(200)
  })

  it("makes an outro that slows down at the end", () => {
    const made = addOutro(pop())!
    expect(made.section.slowDown).toBe(true)
  })
})

describe("playing with tempo changes", () => {
  it("plays a half-time section at half the speed", () => {
    const { song } = withTempo(50)
    const events = buildEvents(song, CHORDS)
    const map = tempoMap(song)
    const end = layout(song).reduce((n, p) => n + p.beats, 0)
    const heard: { time: number; beat: number }[] = []
    const voice = {
      start: (n: { time: number }) => void heard.push({ ...n, beat: -1 }),
    }
    const tr = createTransport({
      token: 1,
      voices: { chords: voice, melody: voice, bass: voice, drums: voice },
      settings: {
        events,
        bpm: song.bpm,
        tempo: map,
        end,
        loop: false,
        instruments: DEFAULT_INSTRUMENTS,
      },
      from: 0,
      now: 0,
    })
    // Where the playhead is halfway into the slow section, asked just before.
    const p = layout(song)[1]
    const mid = START_DELAY + secondsAt(map, p.start + 2)
    let beatAtMid = NaN
    for (let now = 0; now < 200 && !advance(tr, now); now += 0.1)
      if (Number.isNaN(beatAtMid) && now >= mid - 0.1)
        beatAtMid = beatAt(tr, mid)
    // Every note starts when the tempo map says it should.
    const round = (t: number) => Math.round(t * 1e6) / 1e6
    const want = [
      ...new Set(
        events.map((e) => round(START_DELAY + secondsAt(map, e.start)))
      ),
    ].sort((a, b) => a - b)
    const got = [...new Set(heard.map((h) => round(h.time)))].sort(
      (a, b) => a - b
    )
    expect(got).toHaveLength(want.length)
    got.forEach((t, i) => expect(t).toBeCloseTo(want[i], 6))
    // The playhead follows the tempo too.
    expect(beatAtMid).toBeCloseTo(p.start + 2, 6)
  })

  it("counts in at the tempo the music starts in", () => {
    const song = pop()
    const first = song.arrangement[0].section
    song.sections = song.sections.map((s) =>
      s.id === first ? { ...s, tempo: 50 } : s
    )
    const clicks: number[] = []
    const voice = { start: (n: { time: number }) => void clicks.push(n.time) }
    const tr = createTransport({
      token: 1,
      voices: { chords: voice, melody: voice, bass: voice, drums: voice },
      settings: {
        events: [],
        bpm: 120,
        tempo: [
          { beat: 0, bpm: 60 },
          { beat: 16, bpm: 120 },
        ],
        end: 32,
        loop: false,
        instruments: DEFAULT_INSTRUMENTS,
      },
      from: 0,
      now: 0,
      countIn: { beats: 4, clicks: [0, 1, 2, 3] },
    })
    expect(clicks[1] - clicks[0]).toBeCloseTo(1) // 60 BPM
    expect(tr.startTime).toBeCloseTo(START_DELAY + 4)
  })

  it("makes the WAV as long as the slower song", () => {
    const map = [
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 60 },
    ]
    expect(renderSeconds([], map, 8) - renderSeconds([], 120, 8)).toBeCloseTo(2)
  })
})

/** The tempo events of a MIDI file's first track, as [beat, bpm]. */
function midiTempos(bytes: Uint8Array) {
  let at = 14 + 8 // header chunk, then the first track's header
  const end = at + new DataView(bytes.buffer).getUint32(at - 4)
  let tick = 0
  const out: [number, number][] = []
  const vlq = () => {
    let n = 0
    for (;;) {
      const b = bytes[at++]
      n = (n << 7) | (b & 0x7f)
      if (!(b & 0x80)) return n
    }
  }
  while (at < end) {
    tick += vlq()
    expect(bytes[at]).toBe(0xff) // the conductor track is all meta events
    const type = bytes[at + 1]
    at += 2
    const len = vlq()
    if (type === 0x51) {
      const mpq = (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2]
      out.push([tick / 480, Math.round(60_000_000 / mpq)])
    }
    at += len
  }
  return out
}

describe("MIDI export with tempo changes", () => {
  it("writes a tempo event at every change", () => {
    const { song } = withTempo(50)
    const map = tempoMap(song)
    const bytes = buildMidi(buildEvents(song, CHORDS), {
      bpm: song.bpm,
      tempo: map,
      title: song.title,
      keySig: { sf: 0, minor: false },
    })
    expect(midiTempos(bytes)).toEqual(
      map.map((t) => [t.beat, Math.round(t.bpm)])
    )
  })

  it("writes one tempo when there are no changes", () => {
    const bytes = buildMidi([], {
      bpm: 90,
      title: "x",
      keySig: { sf: 0, minor: false },
    })
    expect(midiTempos(bytes)).toEqual([[0, 90]])
  })
})
