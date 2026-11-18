import { describe, expect, it } from "vitest"

import {
  barLines,
  buildEvents,
  endingBeats,
  layout,
  meterChanges,
  songBars,
} from "@/lib/arrange"
import { chordChart } from "@/lib/chart"
import { EXAMPLES } from "@/lib/examples"
import { buildMidi } from "@/lib/midi"
import { drumSteps, meterOf, midiTimeSig } from "@/lib/meter"
import { addIntro, setMeter, setSectionMeter } from "@/lib/sections"
import { normalizeSong } from "@/lib/song-file"

const pop = () => EXAMPLES.find((e) => e.id === "pop")!.build()
const ALL = { chords: true, melody: true, bass: true, drums: true }

/** The pop example with its chorus (section B) in another time. */
function chorusIn(meter: "3/4" | "6/8" | "2/4") {
  const song = pop()
  const id = song.sections[1].id
  return { song: setSectionMeter(song, id, meter), id }
}

describe("a section in a time of its own", () => {
  it("fits the section's chords, melody and drums to the new bar", () => {
    const { song, id } = chorusIn("3/4")
    const s = song.sections.find((x) => x.id === id)!
    expect(s.meter).toBe("3/4")
    // Four bars of 4/4 become four bars of 3/4.
    expect(s.chords.map((c) => c.beats)).toEqual([3, 3, 3, 3])
    expect(s.drums.pattern.kick).toHaveLength(drumSteps(meterOf("3/4")))
    const steps = 12 * 2
    for (const n of s.melody)
      expect(n.start + n.length).toBeLessThanOrEqual(steps)
    // The other sections are untouched.
    expect(song.sections[0].chords.map((c) => c.beats)).toEqual([4, 4, 4, 4])
  })

  it("goes back to the song's time", () => {
    const { song, id } = chorusIn("3/4")
    const back = setSectionMeter(song, id, undefined)
    const s = back.sections.find((x) => x.id === id)!
    expect(s.meter).toBeUndefined()
    expect(s.chords.map((c) => c.beats)).toEqual([4, 4, 4, 4])
    // Choosing the song's own time is the same as going back.
    const same = setSectionMeter(song, id, "4/4")
    expect(same.sections.find((x) => x.id === id)!.meter).toBeUndefined()
  })

  it("keeps its time when the song changes time", () => {
    const { song, id } = chorusIn("3/4")
    const waltz = setMeter(song, "6/8")
    const chorus = waltz.sections.find((x) => x.id === id)!
    expect(chorus.meter).toBe("3/4")
    expect(chorus.chords.map((c) => c.beats)).toEqual([3, 3, 3, 3])
    expect(waltz.sections[0].chords.map((c) => c.beats)).toEqual([3, 3, 3, 3])
    // A section already in the song's new time just follows the song.
    const all = setMeter(song, "3/4")
    expect(all.sections.find((x) => x.id === id)!.meter).toBeUndefined()
  })

  it("counts its bars, and draws them, in its own time", () => {
    const { song } = chorusIn("2/4")
    // Chorus: four bars of 4/4 → four bars of 2/4 (8 beats).
    const placed = layout(song)
    expect(placed[1].beats).toBe(8)
    expect(songBars(song)).toBe(6 * 4)
    const lines = barLines(song, placed)
    expect(lines).toHaveLength(24)
    expect(lines.slice(3, 9).map((b) => b.beats)).toEqual([4, 2, 2, 2, 2, 4])
    expect(lines[4].start).toBe(16)
  })

  it("plays each section's notes in its own time", () => {
    const { song } = chorusIn("3/4")
    const placed = layout(song)
    const events = buildEvents(song, ALL)
    // Nothing from the chorus spills over into the verse after it.
    const chorus = placed[1]
    const end = chorus.start + chorus.beats
    const drums = events.filter(
      (e) => e.track === "drums" && e.start >= chorus.start && e.start < end
    )
    expect(drums.length).toBeGreaterThan(0)
    expect(
      events.some(
        (e) =>
          e.start >= chorus.start &&
          e.start < end &&
          e.start + e.duration > end + 0.5
      )
    ).toBe(false)
  })

  it("lists where the time signature changes", () => {
    const { song } = chorusIn("3/4")
    const placed = layout(song)
    expect(meterChanges(song, placed).map((c) => [c.beat, c.meter.id])).toEqual(
      [
        [0, "4/4"],
        [placed[1].start, "3/4"],
        [placed[2].start, "4/4"],
        [placed[3].start, "3/4"],
        [placed[4].start, "4/4"],
        [placed[5].start, "3/4"],
      ]
    )
  })

  it("starts the song in the first section's time", () => {
    const song = pop()
    const moved = setSectionMeter(song, song.sections[0].id, "6/8")
    expect(meterChanges(moved)[0].meter.id).toBe("6/8")
  })

  it("ends with a bar in the last section's time", () => {
    const { song } = chorusIn("3/4")
    expect(endingBeats({ ...song, ending: "hold" })).toBe(3)
  })

  it("gives an intro the time of the section it comes from", () => {
    const song = pop()
    const moved = setSectionMeter(song, song.sections[0].id, "3/4")
    const made = addIntro(moved)!
    expect(made.section.meter).toBe("3/4")
    expect(made.section.chords.reduce((n, c) => n + c.beats, 0)).toBe(12)
  })

  it("is saved with the section", () => {
    const { song, id } = chorusIn("6/8")
    const back = normalizeSong(JSON.parse(JSON.stringify(song)))
    const s = back.sections.find((x) => x.id === id)!
    expect(s.meter).toBe("6/8")
    expect(s.drums.pattern.kick).toHaveLength(drumSteps(meterOf("6/8")))
    // The song's own time isn't kept as a section's.
    const odd = normalizeSong({
      ...song,
      sections: song.sections.map((x) => ({ ...x, meter: "4/4" })),
    })
    expect(odd.sections.every((x) => !x.meter)).toBe(true)
  })

  it("shows on the chord chart", () => {
    const { song } = chorusIn("3/4")
    const chart = chordChart(song)
    expect(chart.sections[1].notes).toContain("In 3/4")
    expect(chart.sections[1].bars).toHaveLength(4)
    expect(chart.sections[0].notes).not.toContain("In 4/4")
  })

  it("writes a MIDI time signature at every change", () => {
    const { song } = chorusIn("3/4")
    const changes = meterChanges(song)
    const bytes = buildMidi([], {
      bpm: 120,
      title: "x",
      keySig: { sf: 0, minor: false },
      timeSig: midiTimeSig(changes[0].meter),
      timeSigChanges: changes
        .slice(1)
        .map((c) => ({ beat: c.beat, timeSig: midiTimeSig(c.meter) })),
    })
    // Every FF 58 04 nn dd event, as "nn/2^dd".
    const sigs: string[] = []
    for (let i = 0; i + 5 < bytes.length; i++)
      if (bytes[i] === 0xff && bytes[i + 1] === 0x58 && bytes[i + 2] === 4)
        sigs.push(`${bytes[i + 3]}/${2 ** bytes[i + 4]}`)
    expect(sigs).toEqual(["4/4", "3/4", "4/4", "3/4", "4/4", "3/4"])
  })
})
