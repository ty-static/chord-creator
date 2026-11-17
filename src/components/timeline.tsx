import * as React from "react"
import { RepeatIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  type Chord,
  type Key,
  type Voicing,
  chordName,
  totalBeats,
} from "@/lib/music"
import { cn } from "@/lib/utils"

export interface LoopRange {
  start: number // beats
  end: number // beats (exclusive)
}

interface Props {
  musicKey: Key
  chords: Chord[]
  playheadBeat: number | null
  loopRange: LoopRange | null
  activeChordId: string | null
  voicings?: Voicing[]
  onSeek: (beat: number) => void
  onLoopChange: (range: LoopRange | null) => void
}

const BEATS_PER_BAR = 4

export function Timeline({
  musicKey,
  chords,
  playheadBeat,
  loopRange,
  activeChordId,
  voicings,
  onSeek,
  onLoopChange,
}: Props) {
  const total = totalBeats(chords)
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

  const segments: { chord: Chord; start: number }[] = []
  let chordStart = 0
  for (const [i, c] of chords.entries()) {
    const chord = voicings?.[i] ? { ...c, inversion: voicings[i].inversion } : c
    segments.push({ chord, start: chordStart })
    chordStart += chord.beats
  }

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
      <div className="relative overflow-hidden rounded-lg border bg-card select-none">
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
                width: pct(Math.min(BEATS_PER_BAR, total - i * BEATS_PER_BAR)),
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
        {/* Chord lane */}
        <div className="relative flex h-9">
          {segments.map(({ chord, start }) => (
            <button
              key={chord.id}
              type="button"
              title={`Play from ${chordName(chord, musicKey)}`}
              onClick={() => onSeek(start)}
              className={cn(
                "flex shrink-0 items-center truncate border-l px-2 text-left text-sm font-medium first:border-l-0 hover:bg-muted",
                chord.id === activeChordId && "bg-primary/15"
              )}
              style={{ width: pct(chord.beats) }}
            >
              {chordName(chord, musicKey)}
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
  )
}
