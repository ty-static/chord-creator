import * as React from "react"
import { RepeatIcon, XIcon } from "lucide-react"

import { sectionColor } from "@/components/section-style"
import { Button } from "@/components/ui/button"
import {
  type Chord,
  type Key,
  chordName,
  keyLabel,
  noteName,
} from "@/lib/music"
import { cn } from "@/lib/utils"

export interface LoopRange {
  start: number // beats
  end: number // beats (exclusive)
}

/** One slot of the form, as the timeline draws it. */
export interface TimelinePart {
  slotId: string
  sectionId: string
  letter: string
  name: string
  /** Index of the section, for its colour. */
  colorIndex: number
  start: number // beats
  beats: number
  /** The section's chords, with the inversions they're played in. */
  chords: Chord[]
  /** The part's key, when a key change moves it away from the song's. */
  musicKey?: Key
}

interface Props {
  musicKey: Key
  parts: TimelinePart[]
  playheadBeat: number | null
  loopRange: LoopRange | null
  /** `slotId:chordId` of the chord playing now. */
  activeChordKey: string | null
  selectedSectionId: string
  onSelectSection: (sectionId: string) => void
  onSeek: (beat: number) => void
  onLoopChange: (range: LoopRange | null) => void
}

const BEATS_PER_BAR = 4
/** Bars never get narrower than this; long songs scroll sideways. */
const MIN_BAR_PX = 44

export function Timeline({
  musicKey,
  parts,
  playheadBeat,
  loopRange,
  activeChordKey,
  selectedSectionId,
  onSelectSection,
  onSeek,
  onLoopChange,
}: Props) {
  const total = parts.reduce((n, p) => n + p.beats, 0)
  const bars = Math.ceil(total / BEATS_PER_BAR)
  const laneRef = React.useRef<HTMLDivElement>(null)
  const [drag, setDrag] = React.useState<{
    anchor: number
    current: number
    pointerId: number
  } | null>(null)

  if (!total) return null
  const pct = (beat: number) => `${(beat / total) * 100}%`

  const barAt = (e: React.PointerEvent) => {
    const rect = laneRef.current!.getBoundingClientRect()
    const beat = ((e.clientX - rect.left) / rect.width) * total
    return Math.max(0, Math.min(bars - 1, Math.floor(beat / BEATS_PER_BAR)))
  }

  const selection = drag
    ? {
        start: Math.min(drag.anchor, drag.current) * BEATS_PER_BAR,
        end: Math.min(
          total,
          (Math.max(drag.anchor, drag.current) + 1) * BEATS_PER_BAR
        ),
      }
    : loopRange

  const segments: { key: string; chord: Chord; start: number; k: Key }[] = []
  for (const p of parts) {
    let start = p.start
    for (const chord of p.chords) {
      segments.push({
        key: `${p.slotId}:${chord.id}`,
        chord,
        start,
        k: p.musicKey ?? musicKey,
      })
      start += chord.beats
    }
  }
  const multi = parts.length > 1

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <span className="hidden sm:inline">
            Click a bar to play from there · drag across bars to loop a section
          </span>
          <span className="sm:hidden">Tap a bar to play · drag to loop</span>
        </span>
        {loopRange && (
          <Button size="xs" variant="ghost" onClick={() => onLoopChange(null)}>
            <XIcon /> Clear loop
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <div
          className="relative select-none"
          style={{ minWidth: bars * MIN_BAR_PX }}
        >
          {/* Sections of the form */}
          {multi && (
            <div className="relative flex h-6 border-b">
              {parts
                .filter((p) => p.beats > 0)
                .map((p) => (
                  <button
                    key={p.slotId}
                    type="button"
                    title={
                      p.musicKey
                        ? `Edit ${p.name} (in ${keyLabel(p.musicKey)})`
                        : `Edit ${p.name}`
                    }
                    onClick={() => onSelectSection(p.sectionId)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 truncate border-l px-1.5 text-left text-[11px] font-medium first:border-l-0",
                      sectionColor(p.colorIndex).band,
                      p.sectionId === selectedSectionId &&
                        "underline decoration-2 underline-offset-2"
                    )}
                    style={{ width: pct(p.beats) }}
                  >
                    <span className="font-semibold">{p.letter}</span>
                    <span className="truncate">{p.name}</span>
                    {p.musicKey && (
                      <span className="ml-auto shrink-0 rounded-sm bg-background/70 px-1 text-[10px] font-semibold">
                        {noteName(p.musicKey.root, p.musicKey)}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          )}
          {/* Bar ruler */}
          <div
            ref={laneRef}
            className="relative flex h-6 cursor-pointer touch-none border-b"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              const bar = barAt(e)
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                /* pointer already gone */
              }
              setDrag({ anchor: bar, current: bar, pointerId: e.pointerId })
            }}
            onPointerMove={(e) => {
              if (!drag || e.pointerId !== drag.pointerId) return
              const bar = barAt(e)
              if (bar !== drag.current) setDrag({ ...drag, current: bar })
            }}
            onPointerUp={(e) => {
              if (!drag || e.pointerId !== drag.pointerId) return
              if (drag.anchor === drag.current)
                onSeek(drag.anchor * BEATS_PER_BAR)
              else if (selection) onLoopChange(selection)
              setDrag(null)
            }}
            onPointerCancel={() => setDrag(null)}
          >
            {Array.from({ length: bars }, (_, i) => (
              <div
                key={i}
                className="flex shrink-0 items-center border-l px-1.5 font-mono text-[10px] text-muted-foreground first:border-l-0 hover:bg-muted"
                style={{
                  width: pct(
                    Math.min(BEATS_PER_BAR, total - i * BEATS_PER_BAR)
                  ),
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>
          {/* Chord lane */}
          <div className="relative flex h-9">
            {segments.map(({ key, chord, start, k }) => (
              <button
                key={key}
                type="button"
                title={`Play from ${chordName(chord, k)}`}
                onClick={() => onSeek(start)}
                className={cn(
                  "flex shrink-0 items-center truncate border-l px-2 text-left text-sm font-medium first:border-l-0 hover:bg-muted",
                  key === activeChordKey && "bg-primary/15"
                )}
                style={{ width: pct(chord.beats) }}
              >
                {chordName(chord, k)}
              </button>
            ))}
          </div>

          {selection && (
            <div
              className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/10"
              style={{
                left: pct(selection.start),
                width: pct(selection.end - selection.start),
              }}
            >
              <RepeatIcon className="absolute top-1 right-1 size-3 text-primary" />
            </div>
          )}
          {playheadBeat !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-destructive"
              style={{ left: pct(Math.min(playheadBeat, total)) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
