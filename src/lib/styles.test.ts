import { describe, expect, it } from "vitest"

import { EXAMPLES } from "@/lib/examples"
import { matchingPreset } from "@/lib/drums"
import { TRACK_INSTRUMENTS } from "@/lib/instruments"
import {
  ARRANGE_STYLES,
  applyStyle,
  arrangeStyle,
  styleDrums,
} from "@/lib/styles"

const song = EXAMPLES[0].build()

describe("arrangement styles", () => {
  it("only use instruments and grooves the app has", () => {
    for (const s of ARRANGE_STYLES) {
      for (const track of ["chords", "bass", "drums"] as const)
        expect(TRACK_INSTRUMENTS[track]).toContain(s.instruments[track])
      if (s.drums) expect(matchingPreset(styleDrums(s).pattern)).toBe(s.drums)
    }
  })

  it("falls back to pop for an unknown or missing style", () => {
    expect(arrangeStyle("polka").id).toBe("pop")
    expect(arrangeStyle(null).id).toBe("pop")
    expect(arrangeStyle("reggae").label).toBe("Reggae")
  })

  it("plays the song in the style, keeping the melody's instrument", () => {
    const reggae = applyStyle(song, arrangeStyle("reggae"))
    expect(reggae.chordStyle).toBe("offbeat")
    expect(reggae.bass).toBe(true)
    expect(reggae.bassStyle).toBeUndefined() // roots
    expect(reggae.instruments.chords).toBe("organ")
    expect(reggae.instruments.melody).toBe(song.instruments.melody)
    expect(styleDrums(arrangeStyle("reggae")).enabled).toBe(true)

    const lofi = applyStyle(
      { ...song, bassStyle: "walking" },
      arrangeStyle("lofi")
    )
    expect(lofi.swing).toBe(0.4)
    expect(lofi.bassStyle).toBeUndefined()
    expect(applyStyle(lofi, arrangeStyle("pop")).swing).toBeUndefined()
  })

  it("can leave out the bass and drums", () => {
    const plain = arrangeStyle("plain")
    expect(applyStyle(song, plain).bass).toBe(false)
    expect(styleDrums(plain).enabled).toBe(false)
  })
})
