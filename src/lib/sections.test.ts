import { describe, expect, it } from "vitest"

import {
  type Song,
  buildEvents,
  layout,
  partEvents,
  partOf,
  placedAt,
  songBeats,
} from "@/lib/arrange"
import { DEFAULT_MIX } from "@/lib/audio-engine"
import { DEFAULT_DRUMS, presetPattern } from "@/lib/drums"
import { EXAMPLES } from "@/lib/examples"
import { DEFAULT_INSTRUMENTS } from "@/lib/instruments"
import type { Chord } from "@/lib/music"
import {
  MAX_SECTIONS,
  MAX_SLOTS,
  addSection,
  addSlot,
  copySection,
  formString,
  makeSection,
  makeVariation,
  migrateSong,
  moveSlot,
  nextSectionName,
  parseForm,
  removeSection,
  removeSlot,
  repeatSlot,
  updateSection,
  variantName,
} from "@/lib/sections"

const ALL = { chords: true, melody: true, bass: true, drums: true }

let n = 0
const chords = (...degrees: number[]): Chord[] =>
  degrees.map((degree) => ({
    id: `c${n++}`,
    degree,
    type: "triad",
    inversion: 0,
    beats: 4,
  }))

/** A song with sections A (2 bars), B (1 bar), C (3 bars), in the form given. */
function song(form = "A A B A"): Song {
  const a = makeSection("Verse", chords(0, 4), [
    { id: "m1", start: 0, length: 4, degree: 7 },
  ])
  const b = makeSection("Chorus", chords(3), [], {
    ...DEFAULT_DRUMS,
    enabled: true,
    pattern: presetPattern("rock"),
  })
  const c = makeSection("Bridge", chords(5, 1, 4))
  const base: Song = {
    key: { root: 0, scale: "major" },
    bpm: 120,
    sections: [a, b, c],
    arrangement: [],
    chordStyle: "block",
    bass: true,
    instruments: DEFAULT_INSTRUMENTS,
    reverb: 0.2,
    mix: DEFAULT_MIX,
    voiceLeading: false,
  }
  const parsed = parseForm(base, form)
  if ("error" in parsed) throw new Error(parsed.error)
  return { ...base, arrangement: parsed.slots }
}

const letters = (s: Song) => formString(s).replace(/ /g, "")

describe("layout", () => {
  it("places the form's parts one after another", () => {
    const s = song("A A B A C")
    const placed = layout(s)
    expect(placed.map((p) => [p.section.name, p.start, p.beats])).toEqual([
      ["Verse", 0, 8],
      ["Verse", 8, 8],
      ["Chorus", 16, 4],
      ["Verse", 20, 8],
      ["Bridge", 28, 12],
    ])
    expect(songBeats(s)).toBe(40)
  })

  it("finds the part playing at a beat", () => {
    const placed = layout(song("A B"))
    expect(placedAt(placed, 0)?.section.name).toBe("Verse")
    expect(placedAt(placed, 7.99)?.section.name).toBe("Verse")
    expect(placedAt(placed, 8)?.section.name).toBe("Chorus")
    expect(placedAt(placed, 12)).toBeNull()
  })

  it("skips slots whose section is gone", () => {
    const s = song("A B")
    const broken = {
      ...s,
      arrangement: [...s.arrangement, { id: "x", section: "nope" }],
    }
    expect(layout(broken)).toHaveLength(2)
  })
})

describe("buildEvents", () => {
  it("plays each part's own notes, shifted to where it sits in the form", () => {
    const s = song("A B A")
    const events = buildEvents(s, ALL)
    const [a, b] = s.sections
    const aEvents = partEvents(partOf(s, a), ALL)
    const bEvents = partEvents(partOf(s, b), ALL)
    expect(events).toHaveLength(aEvents.length * 2 + bEvents.length)

    const shape = (es: typeof events, by = 0) =>
      es.map((e) => [e.track, e.midi, e.start + by, e.duration]).sort()
    const second = events.filter((e) => e.start >= 8 && e.start < 12)
    const third = events.filter((e) => e.start >= 12)
    expect(shape(second)).toEqual(shape(bEvents, 8))
    expect(shape(third)).toEqual(shape(aEvents, 12))
  })

  it("gives each section its own drum beat", () => {
    const s = song("A B")
    const drums = buildEvents(s, ALL).filter((e) => e.track === "drums")
    // Only the chorus has drums on.
    expect(drums.length).toBeGreaterThan(0)
    expect(drums.every((e) => e.start >= 8 && e.start < 12)).toBe(true)
  })

  it("renders the melody of each part in place", () => {
    const melody = buildEvents(song("A A"), ALL).filter(
      (e) => e.track === "melody"
    )
    expect(melody.map((e) => e.start)).toEqual([0, 8])
  })
})

describe("the form as letters", () => {
  it("prints and reads it back", () => {
    const s = song("A A B A")
    expect(formString(s)).toBe("A A B A")
    for (const typed of ["aaba", "A-A-B-A", "A, A, B, A"]) {
      const r = parseForm(s, typed)
      expect("slots" in r && r.slots.map((x) => x.section)).toEqual(
        s.arrangement.map((x) => x.section)
      )
    }
  })

  it("names the letter that has no section", () => {
    expect(parseForm(song(), "A B D")).toEqual({
      error: "There's no section D.",
    })
    expect("error" in parseForm(song(), " ")).toBe(true)
    expect("error" in parseForm(song(), "A".repeat(MAX_SLOTS + 1))).toBe(true)
  })

  it("keeps the existing parts when the form is retyped", () => {
    const s = song("A B A")
    const r = parseForm(s, "B A A A")
    if (!("slots" in r)) throw new Error(r.error)
    const [a1, b, a2] = s.arrangement
    expect(r.slots.slice(0, 3)).toEqual([b, a1, a2])
    expect([a1.id, b.id, a2.id]).not.toContain(r.slots[3].id) // a new part
  })

  it("gives every slot its own id, even for repeats", () => {
    const r = parseForm(song(), "AAAA")
    expect("slots" in r && new Set(r.slots.map((x) => x.id)).size).toBe(4)
  })
})

describe("editing the form", () => {
  it("repeats a part straight after itself", () => {
    const s = song("A B")
    expect(letters(repeatSlot(s, s.arrangement[1].id))).toBe("ABB")
  })

  it("adds, moves and removes parts", () => {
    const s = song("A B")
    expect(letters(addSlot(s, s.sections[2].id))).toBe("ABC")
    expect(letters(addSlot(s, s.sections[2].id, 0))).toBe("CAB")
    expect(letters(moveSlot(song("A B C"), 0, 2))).toBe("BCA")
    expect(letters(removeSlot(s, s.arrangement[0].id))).toBe("B")
  })

  it("never empties the form or goes past the limit", () => {
    const one = song("A")
    expect(removeSlot(one, one.arrangement[0].id)).toBe(one)
    let s = song("A")
    for (let i = 0; i < MAX_SLOTS + 5; i++) s = addSlot(s, s.sections[0].id)
    expect(s.arrangement).toHaveLength(MAX_SLOTS)
  })
})

describe("editing sections", () => {
  it("changes only the section asked for", () => {
    const s = song("A B A")
    const next = updateSection(s, s.sections[0].id, { name: "Intro" })
    expect(next.sections.map((x) => x.name)).toEqual([
      "Intro",
      "Chorus",
      "Bridge",
    ])
    expect(next.sections[1]).toBe(s.sections[1])
    // Both A parts play the renamed section.
    expect(layout(next).map((p) => p.section.name)).toEqual([
      "Intro",
      "Chorus",
      "Intro",
    ])
  })

  it("copies a section deeply, with fresh ids", () => {
    const a = song().sections[0]
    const copy = copySection(a, "Verse 2")
    expect(copy.id).not.toBe(a.id)
    expect(copy.chords.map((c) => c.degree)).toEqual(
      a.chords.map((c) => c.degree)
    )
    expect(copy.chords.map((c) => c.id)).not.toEqual(a.chords.map((c) => c.id))
    copy.drums.pattern.kick[3] = 2
    expect(a.drums.pattern.kick[3]).toBe(0)
  })

  it("adds a new section to the end of the form", () => {
    const s = song("A B")
    const next = addSection(s, makeSection("Outro", chords(0)))
    expect(letters(next)).toBe("ABD")
    expect(nextSectionName(s)).toBe("Intro")
  })

  it("deletes a section and every part that plays it", () => {
    const s = song("A B A C")
    const next = removeSection(s, s.sections[0].id)
    expect(next.sections.map((x) => x.name)).toEqual(["Chorus", "Bridge"])
    // Letters follow the section order, so B and C become A and B.
    expect(formString(next)).toBe("A B")
  })

  it("keeps the last section, and a form to play it", () => {
    const one: Song = { ...song("A"), sections: [song("A").sections[0]] }
    const s1 = {
      ...one,
      arrangement: [{ id: "s", section: one.sections[0].id }],
    }
    expect(removeSection(s1, s1.sections[0].id)).toBe(s1)
    // Deleting the only section in the form leaves another one playing.
    const s2 = song("B")
    const next = removeSection(s2, s2.sections[1].id)
    expect(layout(next).map((p) => p.section.name)).toEqual(["Verse"])
  })

  it("turns one repeat into a variation without touching the others", () => {
    const s = song("A B A")
    const next = makeVariation(s, s.arrangement[2].id)
    expect(next.sections.map((x) => x.name)).toEqual([
      "Verse",
      "Chorus",
      "Bridge",
      "Verse 2",
    ])
    expect(formString(next)).toBe("A B D")
    expect(variantName(next, "Verse 2")).toBe("Verse 3")
  })

  it("stops at the section limit", () => {
    let s = song("A")
    for (let i = 0; i < MAX_SECTIONS + 2; i++)
      s = addSection(s, makeSection(nextSectionName(s), chords(0)))
    expect(s.sections).toHaveLength(MAX_SECTIONS)
    expect(makeVariation(s, s.arrangement[0].id)).toBe(s)
  })
})

describe("migrateSong", () => {
  it("wraps a song saved before sections into section A", () => {
    const old = {
      chords: chords(0, 4, 5, 3),
      melody: [{ id: "m", start: 0, length: 2, degree: 4 }],
      drums: { enabled: true, pattern: presetPattern("pop") },
    }
    const { sections, arrangement } = migrateSong(old)
    expect(sections).toHaveLength(1)
    expect(sections[0].name).toBe("Verse")
    expect(sections[0].chords).toEqual(old.chords)
    expect(sections[0].melody).toEqual(old.melody)
    expect(sections[0].drums).toEqual({ ...DEFAULT_DRUMS, ...old.drums })
    expect(arrangement.map((s) => s.section)).toEqual([sections[0].id])
  })

  it("keeps a sectioned song, dropping slots that point nowhere", () => {
    const s = song("A B")
    const saved = {
      ...s,
      arrangement: [...s.arrangement, { id: "x", section: "gone" }],
    }
    const { sections, arrangement } = migrateSong(saved)
    expect(sections.map((x) => x.id)).toEqual(s.sections.map((x) => x.id))
    expect(arrangement).toEqual(s.arrangement)
  })

  it("survives an empty form", () => {
    const s = song("A")
    expect(migrateSong({ ...s, arrangement: [] }).arrangement).toHaveLength(1)
  })
})

describe("examples", () => {
  it("all have a valid form", () => {
    for (const ex of EXAMPLES) {
      const s = ex.build()
      expect(layout(s)).toHaveLength(s.arrangement.length)
      expect(songBeats(s)).toBeGreaterThan(0)
    }
  })

  it("include a whole song with verse, chorus and bridge", () => {
    const pop = EXAMPLES.find((e) => e.id === "pop")!.build()
    expect(pop.sections.map((s) => s.name)).toEqual([
      "Verse",
      "Chorus",
      "Bridge",
    ])
    expect(formString(pop)).toBe("A B A B C B")
  })
})
