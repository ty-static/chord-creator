import { describe, expect, it } from "vitest"

import { barsOf, chartText, chordChart, formLine } from "@/lib/chart"
import { EXAMPLES } from "@/lib/examples"
import type { Chord } from "@/lib/music"
import { addSlot } from "@/lib/sections"

const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()
const chord = (degree: number, beats: number): Chord => ({
  id: String(Math.random()),
  degree,
  type: "triad",
  inversion: 0,
  beats,
})
const names = ["I", "ii", "iii", "IV", "V", "vi", "vii"]
const named = (c: Chord) => names[c.degree]

describe("bars of a chord chart", () => {
  it("puts one chord in each bar", () => {
    const bars = barsOf([chord(0, 4), chord(4, 4)], 4, named)
    expect(bars).toEqual([[{ name: "I", beats: 4 }], [{ name: "V", beats: 4 }]])
  })

  it("shares a bar between short chords", () => {
    const bars = barsOf([chord(0, 2), chord(3, 2), chord(4, 4)], 4, named)
    expect(bars.map((b) => b.map((c) => c.name))).toEqual([["I", "IV"], ["V"]])
  })

  it("leaves the bars a long chord rings on empty", () => {
    const bars = barsOf([chord(0, 8), chord(4, 4)], 4, named)
    expect(bars.map((b) => b.map((c) => c.name))).toEqual([["I"], [], ["V"]])
  })

  it("writes a chord again in a bar it shares after crossing the bar line", () => {
    const bars = barsOf([chord(0, 2), chord(3, 4), chord(4, 2)], 4, named)
    expect(bars.map((b) => b.map((c) => `${c.name}:${c.beats}`))).toEqual([
      ["I:2", "IV:2"],
      ["IV:2", "V:2"],
    ])
  })

  it("counts bars in the song's time signature", () => {
    // 6/8: a bar is three quarter-note beats.
    const bars = barsOf([chord(0, 3), chord(4, 3), chord(0, 6)], 3, named)
    expect(bars.map((b) => b.map((c) => c.name))).toEqual([
      ["I"],
      ["V"],
      ["I"],
      [],
    ])
  })
})

describe("chord chart", () => {
  it("has the song's key, tempo and form", () => {
    const chart = chordChart(pop())
    expect(chart.key).toBe("C Major")
    expect(chart.bpm).toBe(112)
    expect(chart.meter).toBe("4/4")
    expect(formLine(chart.form)).toBe(
      "A Verse · B Chorus · A Verse · B Chorus · C Bridge · B Chorus"
    )
    expect(chart.sections.map((s) => s.name)).toEqual([
      "Verse",
      "Chorus",
      "Bridge",
    ])
    expect(chart.sections[0].bars.flat().map((c) => c.name)).toEqual([
      "Am",
      "F",
      "C",
      "G",
    ])
  })

  it("groups a section played twice in a row", () => {
    const song = pop()
    const verse = song.sections[0].id
    const next = addSlot(song, verse, 0)
    expect(chordChart(next).form[0]).toEqual({
      letter: "A",
      name: "Verse",
      times: 2,
    })
  })

  it("can be written in numerals", () => {
    const chart = chordChart(pop(), { numerals: true })
    expect(chart.sections[0].bars.flat().map((c) => c.name)).toEqual([
      "vi",
      "IV",
      "I",
      "V",
    ])
  })

  it("transposes the chords and the key", () => {
    const chart = chordChart(pop(), { transpose: 2 })
    expect(chart.key).toBe("D Major")
    expect(chart.sections[0].bars.flat().map((c) => c.name)).toEqual([
      "Bm",
      "G",
      "D",
      "A",
    ])
  })

  it("notes how a section is played differently", () => {
    const song = pop()
    song.sections[1] = {
      ...song.sections[1],
      transpose: 1,
      tempo: 50,
      slowDown: true,
    }
    song.ending = "hold"
    const chart = chordChart(song)
    expect(chart.sections[1].notes).toEqual([
      "Key of D♭ Major",
      "Half time (56 BPM)",
      "Slow down at the end",
    ])
    expect(chart.sections[1].bars[0][0].name).toBe("D♭")
    expect(chart.ending).toBe("Final chord")
  })

  it("leaves out sections that aren't in the form", () => {
    const song = pop()
    song.arrangement = song.arrangement.filter(
      (s) => s.section !== song.sections[2].id
    )
    expect(chordChart(song).sections.map((s) => s.letter)).toEqual(["A", "B"])
  })

  it("copies as plain text with the bar lines lined up", () => {
    const song = pop()
    song.sections[0].chords = [chord(0, 8), chord(4, 2), chord(3, 2)]
    const text = chartText(chordChart(song))
    expect(text).toContain("Key: C Major · 112 BPM · 4/4")
    expect(text).toContain("[A] Verse\n| C    | %    | G F  |")
    const rows = text.split("\n").filter((l) => l.startsWith("|"))
    for (const r of rows)
      expect(
        r
          .split("|")
          .slice(1, -1)
          .every((c) => c.length === 6)
      ).toBe(true)
  })
})
