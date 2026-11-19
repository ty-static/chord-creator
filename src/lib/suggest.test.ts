import { describe, expect, it } from "vitest"

import { clickBeats, layout } from "@/lib/arrange"
import { EXAMPLES } from "@/lib/examples"
import {
  type ChordShape,
  type Key,
  outsideChords,
  romanNumeral,
} from "@/lib/music"
import { DEFAULT_INSTRUMENTS } from "@/lib/instruments"
import { CLICK_NOTE, advance, createTransport } from "@/lib/scheduler"
import { setSectionMeter } from "@/lib/sections"
import { suggestChords } from "@/lib/suggest"
import { clampBpm, tapTempo } from "@/lib/tempo"

const C: Key = { root: 0, scale: "major" }
const Am: Key = { root: 9, scale: "minor" }
const chords = (...degrees: number[]) =>
  degrees.map((degree) => ({ degree, type: "triad" as const, beats: 4 }))
const next = (key: Key, ...degrees: number[]) =>
  suggestChords(chords(...degrees), key, { bar: 4 })
const numerals = (key: Key, ...degrees: number[]) =>
  next(key, ...degrees).map((s) => romanNumeral(s.chord, key))

describe("chord suggestions", () => {
  it("start at home, on vi or on IV", () => {
    expect(numerals(C)).toEqual(["I", "vi", "IV"])
  })

  it("carry on a well-known loop", () => {
    const [top] = next(C, 0, 4, 5)
    expect(romanNumeral(top.chord, C)).toBe("IV")
    expect(top.reason).toBe("Carries on I–V–vi–IV")
    expect(numerals(C, 5, 3, 0)[0]).toBe("V")
    expect(numerals(Am, 0, 5, 2)[0]).toBe("VII")
  })

  it("follow the most common moves", () => {
    expect(numerals(C, 1)[0]).toBe("V") // ii → V
    expect(numerals(C, 4).slice(0, 2)).toContain("I") // V → I
  })

  it("offer a cadence at the end of a phrase", () => {
    // Three bars in: the fourth ends the phrase.
    const s = next(C, 0, 1, 2)
    expect(s.some((x) => /Ends the phrase/.test(x.reason))).toBe(true)
    // …but not in the middle of one.
    expect(next(C, 0).some((x) => /Ends the phrase/.test(x.reason))).toBe(false)
  })

  it("count bars in the section's time", () => {
    // In 3/4, three bars of three beats: the next chord ends the phrase.
    const s = suggestChords(
      [0, 1, 2].map((degree) => ({ degree, type: "triad" as const, beats: 3 })),
      C,
      { bar: 3 }
    )
    expect(s.some((x) => /Ends the phrase/.test(x.reason))).toBe(true)
  })

  it("add one colour from outside the key", () => {
    const s = next(C, 0)
    expect(s.filter((x) => x.chord.secondary)).toHaveLength(1)
    // In a minor key, the major V.
    const minor = next(Am, 0).at(-1)!
    expect(minor.chord).toMatchObject({ degree: 4, mode: "harmonicMinor" })
  })

  it("resolve a chord from outside the key", () => {
    const v7ofV: ChordShape = { degree: 4, type: "seventh", secondary: true }
    const s = suggestChords([{ ...v7ofV, beats: 4 }], C, { bar: 4 })
    expect(romanNumeral(s[0].chord, C)).toBe("V")
    expect(s[0].reason).toBe("Where V7/V wants to go")
  })

  it("never repeat the last chord, and only offer chords on the palette", () => {
    for (const key of [C, Am, { root: 2, scale: "dorian" } as Key])
      for (let d = 0; d < 7; d++) {
        const s = next(key, d)
        expect(s.length).toBeGreaterThanOrEqual(3)
        for (const { chord, reason } of s) {
          expect(reason).not.toBe("")
          if (!chord.mode && !chord.secondary) expect(chord.degree).not.toBe(d)
          else
            expect(
              outsideChords(key).some(
                (o) =>
                  o.chord.degree === chord.degree &&
                  o.chord.mode === chord.mode &&
                  !!o.chord.secondary === !!chord.secondary
              )
            ).toBe(true)
        }
      }
  })
})

describe("tap tempo", () => {
  it("averages the gaps between taps", () => {
    expect(tapTempo([0])).toBeNull()
    expect(tapTempo([0, 500])).toBe(120)
    expect(tapTempo([0, 600, 1200, 1800])).toBe(100)
  })

  it("starts again after a pause", () => {
    expect(tapTempo([0, 1000, 5000, 5500, 6000])).toBe(120)
  })

  it("stays in range", () => {
    expect(tapTempo([0, 100])).toBe(200)
    expect(tapTempo([0, 1900])).toBe(50)
    expect(clampBpm(87.6)).toBe(88)
  })
})

describe("metronome", () => {
  const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()

  it("clicks every beat, accenting the first of each bar", () => {
    const song = pop()
    const clicks = clickBeats(song)
    expect(clicks).toHaveLength(24 * 4)
    expect(clicks.slice(0, 5)).toEqual([
      { beat: 0, accent: true },
      { beat: 1 },
      { beat: 2 },
      { beat: 3 },
      { beat: 4, accent: true },
    ])
  })

  it("clicks the felt beats of each section's time", () => {
    const song = pop()
    const moved = setSectionMeter(song, song.sections[1].id, "6/8")
    const chorus = layout(moved)[1]
    const inChorus = clickBeats(moved).filter(
      (c) => c.beat >= chorus.start && c.beat < chorus.start + chorus.beats
    )
    // Four bars of 6/8: two dotted-quarter clicks each.
    expect(inChorus.map((c) => c.beat - chorus.start)).toEqual([
      0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5,
    ])
  })

  it("plays the clicks on the click voice while the song plays", () => {
    const heard: { note: number; velocity: number }[] = []
    const clicked: number[] = []
    const voice = {
      start: (n: { note: number; velocity: number }) => void heard.push(n),
    }
    const click = { start: (n: { time: number }) => void clicked.push(n.time) }
    const tr = createTransport({
      token: 1,
      voices: {
        chords: voice,
        melody: voice,
        bass: voice,
        drums: voice,
        click,
      },
      settings: {
        events: [],
        bpm: 120,
        end: 8,
        loop: false,
        instruments: DEFAULT_INSTRUMENTS,
        clicks: [0, 1, 2, 3, 4, 5, 6, 7].map((beat) => ({
          beat,
          accent: beat % 4 === 0,
        })),
      },
      from: 0,
      now: 0,
    })
    for (let now = 0; now < 10 && !advance(tr, now); now += 0.1);
    expect(clicked).toHaveLength(8)
    expect(clicked[1] - clicked[0]).toBeCloseTo(0.5) // 120 BPM
    // Not on the drums.
    expect(heard.some((n) => n.note === CLICK_NOTE)).toBe(false)
  })
})
