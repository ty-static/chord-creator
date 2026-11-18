import { describe, expect, it } from "vitest"

import {
  type NoteEvent,
  type Song,
  buildEvents,
  endingBeats,
  layout,
  songBeats,
} from "@/lib/arrange"
import { EXAMPLES } from "@/lib/examples"
import { addIntro, addOutro, setMeter } from "@/lib/sections"
import { normalizeSong } from "@/lib/song-file"

const ALL = { chords: true, melody: true, bass: true, drums: true }
const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()
const pcs = (events: NoteEvent[]) =>
  [...new Set(events.map((e) => e.midi % 12))].sort((a, b) => a - b)

describe("endings", () => {
  it("adds a bar for a final chord or stab, nothing for a fade", () => {
    const song = pop()
    expect(endingBeats(song)).toBe(0)
    expect(endingBeats({ ...song, ending: "hold" })).toBe(4)
    expect(endingBeats({ ...setMeter(song, "6/8"), ending: "stab" })).toBe(3)
    expect(endingBeats({ ...song, ending: "fade" })).toBe(0)
  })

  it("holds the home chord after the form, with bass, kick and crash", () => {
    const song: Song = { ...pop(), ending: "hold" }
    const end = songBeats(song)
    const after = buildEvents(song, ALL).filter((e) => e.start >= end)
    const chords = after.filter((e) => e.track === "chords")
    expect(pcs(chords)).toEqual([0, 4, 7]) // C major
    expect(chords[0].duration).toBeGreaterThan(3.5)
    expect(
      after.filter((e) => e.track === "bass").map((e) => e.midi % 12)
    ).toEqual([0])
    expect(
      after
        .filter((e) => e.track === "drums")
        .map((e) => e.midi)
        .sort()
    ).toEqual([36, 49])
    expect(after.every((e) => e.start === end)).toBe(true)
  })

  it("ends in the last section's key, and leaves out its silent tracks", () => {
    const song: Song = { ...pop(), ending: "stab" }
    const lastId = song.arrangement.at(-1)!.section
    song.sections = song.sections.map((s) =>
      s.id === lastId ? { ...s, transpose: 2, tacet: ["drums"] } : s
    )
    const end = songBeats(song)
    const after = buildEvents(song, ALL).filter((e) => e.start >= end)
    expect(pcs(after.filter((e) => e.track === "chords"))).toEqual([2, 6, 9]) // D major
    expect(after.some((e) => e.track === "drums")).toBe(false)
    // A stab is short.
    expect(Math.max(...after.map((e) => e.duration))).toBeLessThan(0.5)
  })

  it("fades the last bars out", () => {
    const plain = pop()
    const end = songBeats(plain)
    const faded = buildEvents({ ...plain, ending: "fade" }, ALL)
    const before = buildEvents(plain, ALL)
    expect(faded).toHaveLength(before.length)
    faded.forEach((e, i) => {
      if (e.start < end - 16) expect(e.velocity).toBe(before[i].velocity)
      else expect(e.velocity).toBeLessThanOrEqual(before[i].velocity)
    })
    const lastBeat = faded.filter((e) => e.start >= end - 1)
    for (const e of lastBeat)
      expect(e.velocity).toBeLessThan(before[faded.indexOf(e)].velocity * 0.5)
  })

  it("is saved with the song", () => {
    const song = { ...pop(), ending: "hold" as const }
    expect(normalizeSong(JSON.parse(JSON.stringify(song))).ending).toBe("hold")
    expect(normalizeSong({ ...song, ending: "explode" }).ending).toBeUndefined()
  })
})

describe("intros and outros", () => {
  it("adds an intro from the first section's opening bars", () => {
    const song = pop()
    const made = addIntro(song)!
    const placed = layout(made.song)
    expect(placed[0].section.id).toBe(made.section.id)
    expect(made.section.name).toBe("Intro")
    expect(made.section.melody).toEqual([])
    expect(made.section.energy).toBeLessThan(1)
    const first = layout(song)[0].section
    const beats = made.section.chords.reduce((n, c) => n + c.beats, 0)
    expect(beats).toBe(Math.min(16, layout(song)[0].beats))
    expect(made.section.chords.map((c) => c.degree)).toEqual(
      first.chords.slice(0, made.section.chords.length).map((c) => c.degree)
    )
    // A second one gets its own name.
    expect(addIntro(made.song)!.section.name).toBe("Intro 2")
  })

  it("adds an outro from the last section's closing bars, in bars of the meter", () => {
    const song = setMeter(pop(), "3/4")
    const made = addOutro(song)!
    const placed = layout(made.song)
    expect(placed.at(-1)!.section.id).toBe(made.section.id)
    const last = layout(song).at(-1)!.section
    expect(made.section.chords.reduce((n, c) => n + c.beats, 0)).toBe(
      Math.min(12, layout(song).at(-1)!.beats)
    )
    expect(made.section.chords.at(-1)!.degree).toBe(last.chords.at(-1)!.degree)
  })
})
