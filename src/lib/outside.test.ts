import { describe, expect, it } from "vitest"

import { bassLine } from "@/lib/bass"
import { EXAMPLES } from "@/lib/examples"
import { chordFromPitches } from "@/lib/harmony"
import {
  type Chord,
  type ChordShape,
  type Key,
  chordMidi,
  chordName,
  chordToneClasses,
  isOutside,
  noteName,
  outsideChords,
  romanNumeral,
  suggestNext,
  voiceChords,
} from "@/lib/music"
import { decodeShare, encodeShare, normalizeSong } from "@/lib/song-file"

const C: Key = { root: 0, scale: "major" }
const F: Key = { root: 5, scale: "major" }
const Am: Key = { root: 9, scale: "minor" }
const full = (shape: ChordShape): Chord => ({
  id: "x",
  inversion: 0,
  beats: 4,
  ...shape,
})
const label = (c: ChordShape, key: Key) =>
  `${chordName({ ...c, inversion: 0 }, key)} ${romanNumeral(c, key)}`
const names = (pcs: number[], key: Key) => pcs.map((m) => noteName(m, key))

describe("outside chords on offer", () => {
  it("in a major key: secondary dominants and borrowed chords", () => {
    expect(outsideChords(C).map((o) => label(o.chord, C))).toEqual([
      "A7 V7/ii",
      "B7 V7/iii",
      "C7 V7/IV",
      "D7 V7/V",
      "E7 V7/vi",
      "Fm iv",
      "A♭ ♭VI",
      "B♭ ♭VII",
      "E♭ ♭III",
      "D♭ ♭II",
    ])
  })

  it("in a minor key: V and vii° from harmonic minor, Dorian IV, Picardy I", () => {
    expect(outsideChords(Am).map((o) => label(o.chord, Am))).toEqual([
      // (G7, V7/III, is all in the key: left out.)
      "A7 V7/iv",
      "B7 V7/v",
      "C7 V7/VI",
      "D7 V7/VII",
      "E V",
      "G♯dim vii°",
      "D IV",
      "B♭ ♭II",
      "A I",
    ])
  })

  it("leaves out chords that are already in the key", () => {
    const harmonic: Key = { root: 9, scale: "harmonicMinor" }
    const offered = outsideChords(harmonic).map((o) => label(o.chord, harmonic))
    expect(offered).not.toContain("E V")
    const mixo: Key = { root: 0, scale: "mixolydian" }
    expect(
      outsideChords(mixo).some(
        (o) => o.chord.mode === "minor" && o.chord.degree === 6
      )
    ).toBe(false)
  })
})

describe("building outside chords", () => {
  it("V7/V in C is D F♯ A C in the chord register", () => {
    const notes = chordMidi(
      full({ degree: 4, type: "seventh", secondary: true }),
      C
    )
    expect(notes).toEqual([50, 54, 57, 60])
  })

  it("spells borrowed chords with flats and dominants in their own key", () => {
    expect(
      chordName({ degree: 5, type: "triad", mode: "minor", inversion: 0 }, C)
    ).toBe("A♭")
    // V7/vi in F is A7, with a C♯ (not D♭).
    const a7 = { degree: 5, type: "seventh" as const, secondary: true }
    expect(chordName({ ...a7, inversion: 0 }, F)).toBe("A7")
    expect(chordName({ ...a7, inversion: 1 }, F)).toBe("A7/C♯")
  })

  it("melody chord tones are the notes the chord really has", () => {
    // D7 in C: D, A and C are in the scale, F♯ is not (so F isn't a tone).
    expect(
      chordToneClasses({ degree: 4, type: "seventh", secondary: true })
    ).toEqual([0, 1, 5])
    // A♭ major in C has only one scale note (C), so the chord's own
    // degrees are used instead.
    expect(
      chordToneClasses({ degree: 5, type: "triad", mode: "minor" })
    ).toEqual([5, 0, 2])
    expect(
      chordToneClasses({ degree: 3, type: "triad", mode: "minor" })
    ).toEqual([0, 3])
  })

  it("voice-leads and plays a bass line through outside chords", () => {
    const prog = [
      full({ degree: 0, type: "triad" }),
      full({ degree: 4, type: "seventh", secondary: true }),
      full({ degree: 4, type: "triad" }),
      full({ degree: 5, type: "triad", mode: "minor" }),
    ]
    const v = voiceChords(prog, C, true)
    expect(names(v[1].notes, { root: 2, scale: "major" }).sort()).toEqual(
      ["A", "C", "D", "F♯"].sort()
    )
    const bass = bassLine(prog, C, "root").map((n) => noteName(n.midi, F))
    expect(bass).toEqual(["C", "D", "G", "A♭"])
  })
})

describe("suggestions", () => {
  it("start on I, vi or IV", () => {
    expect(suggestNext(undefined, C).map((c) => romanNumeral(c, C))).toEqual([
      "I",
      "vi",
      "IV",
    ])
  })

  it("resolve outside chords where they want to go", () => {
    const r = (c: ChordShape) =>
      suggestNext(c, C).map((s) => romanNumeral(s, C))
    expect(r({ degree: 4, type: "seventh", secondary: true })).toEqual(["V"])
    expect(r({ degree: 5, type: "triad", mode: "minor" })[0]).toBe("♭VII")
    expect(r({ degree: 6, type: "triad", mode: "minor" })[0]).toBe("I")
    expect(r({ degree: 1, type: "triad", mode: "phrygian" })[0]).toBe("V")
  })

  it("after an ordinary chord: common moves plus one colourful one", () => {
    const after = suggestNext({ degree: 0, type: "triad" }, C)
    expect(after.length).toBeGreaterThanOrEqual(3)
    expect(after.some((c) => c.secondary)).toBe(true)
    expect(after.some((c) => c.degree === 0 && !isOutside(c))).toBe(false)
  })

  it("only ever suggests chords the palette offers", () => {
    for (const key of [C, Am, { root: 2, scale: "dorian" } as Key])
      for (let d = 0; d < 7; d++)
        for (const s of suggestNext({ degree: d, type: "triad" }, key)) {
          expect(() => chordName({ ...s, inversion: 0 }, key)).not.toThrow()
          if (isOutside(s))
            expect(
              outsideChords(key).some(
                (o) =>
                  o.chord.degree === s.degree &&
                  o.chord.mode === s.mode &&
                  !!o.chord.secondary === !!s.secondary
              )
            ).toBe(true)
        }
  })
})

describe("recognising outside chords from the keyboard", () => {
  const guess = (pitches: number[], key: Key) => {
    const g = chordFromPitches(pitches, key)!
    return label(g, key)
  }

  it("names chromatic chords, but never turns in-key playing chromatic", () => {
    expect(guess([50, 54, 57, 60], C)).toBe("D7 V7/V")
    expect(guess([56, 60, 63], C)).toBe("A♭ ♭VI")
    expect(guess([52, 56, 59], Am)).toBe("E V")
    expect(guess([48, 52, 55], C)).toBe("C I")
    expect(guess([50, 53, 57], C)).toBe("Dm ii")
    expect(guess([55, 59, 62, 65], C)).toBe("G7 V7")
  })
})

describe("saving outside chords", () => {
  it("round-trips through share links and drops junk", async () => {
    const base = EXAMPLES[0].build()
    const chords: Chord[] = [
      full({ degree: 4, type: "seventh", secondary: true }),
      full({ degree: 5, type: "triad", mode: "minor" }),
    ]
    const song = {
      ...base,
      sections: base.sections.map((s, i) => (i === 0 ? { ...s, chords } : s)),
    }
    const back = await decodeShare(await encodeShare(song))
    expect(back.sections[0].chords.map((c) => label(c, back.key))).toEqual(
      chords.map((c) => label(c, song.key))
    )
    const odd = normalizeSong({
      ...song,
      sections: [
        {
          ...song.sections[0],
          chords: [{ ...chords[0], secondary: "yes", mode: "klingon" }],
        },
      ],
    })
    expect(isOutside(odd.sections[0].chords[0])).toBe(false)
  })
})
