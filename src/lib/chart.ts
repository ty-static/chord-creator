// A chord chart (lead sheet) of a song: each section's chords laid out bar
// by bar, the form in play order, and how each section is played. Used by
// the chord chart dialog, its printout and its plain-text copy.

import type { Song } from "@/lib/arrange"
import { ENDINGS, layout } from "@/lib/arrange"
import {
  type Chord,
  type Key,
  chordName,
  keyLabel,
  romanNumeral,
  sectionKey,
} from "@/lib/music"
import { barBeats, meterOf } from "@/lib/meter"
import { sectionLetter } from "@/lib/sections"
import { sectionTempoLabel } from "@/lib/tempo"

/** One chord in a bar of the chart. */
export interface ChartChord {
  /** "Am7", or "vi7" with numerals. */
  name: string
  /** How long it lasts within this bar, in beats. */
  beats: number
}

/** A bar: the chords that start in it. Empty means the last chord rings on. */
export type ChartBar = ChartChord[]

export interface ChartSection {
  letter: string
  name: string
  bars: ChartBar[]
  /** How the section is played differently, e.g. "Key of D major", "Half time". */
  notes: string[]
}

export interface ChartFormItem {
  letter: string
  name: string
  /** Times in a row, e.g. 2 for "Verse ×2". */
  times: number
}

export interface Chart {
  title: string
  key: string
  bpm: number
  meter: string
  form: ChartFormItem[]
  sections: ChartSection[]
  /** How the song ends, when it doesn't just stop. */
  ending: string | null
}

export interface ChartOptions {
  /** Roman numerals instead of chord names. */
  numerals?: boolean
  /** Move every chord this many semitones (chord names only). */
  transpose?: number
}

/** Bars per line of the chart. */
export const BARS_PER_LINE = 4

/** The key a song's chart is written in, after transposing. */
export const chartKey = (key: Key, transpose = 0): Key =>
  transpose
    ? { root: (((key.root + transpose) % 12) + 12) % 12, scale: key.scale }
    : key

/** Split chords into bars. A chord crossing a bar line starts its bar. */
export function barsOf(
  chords: Chord[],
  bar: number,
  name: (c: Chord) => string
): ChartBar[] {
  const total = chords.reduce((n, c) => n + c.beats, 0)
  const count = Math.max(1, Math.ceil(total / bar - 1e-9))
  const bars: ChartBar[] = Array.from({ length: count }, () => [])
  let at = 0
  for (const c of chords) {
    let left = c.beats
    let first = true
    while (left > 1e-9) {
      const i = Math.min(count - 1, Math.floor(at / bar + 1e-9))
      const room = (i + 1) * bar - at
      const beats = Math.min(left, room)
      // Only where a chord starts is it written; the bars it rings on in
      // stay empty (drawn as a repeat sign), unless it shares that bar.
      if (first) bars[i].push({ name: name(c), beats })
      else if (bars[i].length || beats < bar - 1e-9)
        bars[i].push({ name: name(c), beats })
      first = false
      at += beats
      left -= beats
    }
  }
  return bars
}

export function chordChart(song: Song, opts: ChartOptions = {}): Chart {
  const transpose = opts.numerals ? 0 : (opts.transpose ?? 0)
  const meter = meterOf(song.meter)
  const bar = barBeats(meter)
  const key = chartKey(song.key, transpose)

  const placed = layout(song).filter((p) => p.beats > 0)
  const form: ChartFormItem[] = []
  for (const p of placed) {
    const letter = sectionLetter(song.sections.indexOf(p.section))
    const last = form.at(-1)
    if (last?.letter === letter) last.times++
    else form.push({ letter, name: p.section.name, times: 1 })
  }

  // Each section once, in letter order, if it's in the form.
  const used = new Set(placed.map((p) => p.section.id))
  const sections = song.sections.flatMap((s, i): ChartSection[] => {
    if (!used.has(s.id)) return []
    const k = sectionKey(key, s.transpose ?? 0)
    // Numerals stay in the song's key: a key change shows as a note.
    const name = (c: Chord) =>
      opts.numerals ? romanNumeral(c, song.key) : chordName(c, k)
    const notes: string[] = []
    if (s.transpose)
      notes.push(`Key of ${keyLabel(sectionKey(key, s.transpose))}`)
    if ((s.tempo ?? 100) !== 100)
      notes.push(
        `${sectionTempoLabel(s.tempo!)} (${Math.round((song.bpm * s.tempo!) / 100)} BPM)`
      )
    if (s.slowDown) notes.push("Slow down at the end")
    if (s.buildUp) notes.push("Build up at the end")
    return [
      {
        letter: sectionLetter(i),
        name: s.name,
        bars: barsOf(s.chords, bar, name),
        notes,
      },
    ]
  })

  return {
    title: song.title,
    key: keyLabel(key),
    bpm: song.bpm,
    meter: meter.label,
    form,
    sections,
    ending: ENDINGS.find((e) => e.value === song.ending)?.label ?? null,
  }
}

/** "Verse ×2 · Chorus · Verse" */
export const formLine = (form: ChartFormItem[]) =>
  form
    .map((f) => `${f.letter} ${f.name}${f.times > 1 ? ` ×${f.times}` : ""}`)
    .join(" · ")

/** The chart as plain text, for pasting into a message or notes. */
export function chartText(chart: Chart) {
  const lines = [
    chart.title,
    `Key: ${chart.key} · ${chart.bpm} BPM · ${chart.meter}`,
    `Form: ${formLine(chart.form)}`,
  ]
  // Every bar padded to the same width, so the bar lines line up.
  const cell = (b: ChartBar) =>
    b.length ? b.map((c) => c.name).join(" ") : "%"
  const width = Math.max(
    4,
    ...chart.sections.flatMap((s) => s.bars.map((b) => cell(b).length))
  )
  for (const s of chart.sections) {
    lines.push(
      "",
      `[${s.letter}] ${s.name}${s.notes.length ? ` (${s.notes.join(", ")})` : ""}`
    )
    for (let i = 0; i < s.bars.length; i += BARS_PER_LINE) {
      const row = s.bars.slice(i, i + BARS_PER_LINE)
      lines.push(`| ${row.map((b) => cell(b).padEnd(width)).join(" | ")} |`)
    }
  }
  if (chart.ending) lines.push("", `Ending: ${chart.ending}`)
  return lines.join("\n") + "\n"
}
