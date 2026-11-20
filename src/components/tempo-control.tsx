import * as React from "react"
import { HandIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { MAX_BPM, MIN_BPM, TAP_RESET_MS, clampBpm, tapTempo } from "@/lib/tempo"

/**
 * The song's tempo: a slider, a box to type the BPM into, and a Tap button
 * that sets it from the beat you tap.
 */
export function TempoControl({
  bpm,
  onChange,
  children,
  id = "bpm",
  label = "Tempo",
}: {
  /** For the BPM box (there can be two on a page). */
  id?: string
  label?: string
  bpm: number
  /** `coalesce`: part of a run of changes that undo as one (slider, taps). */
  onChange: (bpm: number, coalesce: boolean) => void
  /** Shown under the slider. */
  children?: React.ReactNode
}) {
  // What's in the box while typing; null shows the song's tempo.
  const [draft, setDraft] = React.useState<string | null>(null)
  const taps = React.useRef<number[]>([])
  const [tapping, setTapping] = React.useState(false)
  const tapTimer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  // Escape blurs the box, and blurring saves: this skips that one save.
  const cancelled = React.useRef(false)
  const commit = () => {
    const skip = cancelled.current
    cancelled.current = false
    if (draft === null) return
    const n = Number(draft)
    if (!skip && draft.trim() && Number.isFinite(n) && clampBpm(n) !== bpm)
      onChange(clampBpm(n), false)
    setDraft(null)
  }

  const tap = () => {
    const now = performance.now()
    const last = taps.current.at(-1)
    if (last !== undefined && now - last > TAP_RESET_MS) taps.current = []
    taps.current = [...taps.current, now].slice(-8)
    const next = tapTempo(taps.current)
    if (next !== null && next !== bpm) onChange(next, true)
    // Show that taps are being counted, until they stop.
    setTapping(true)
    window.clearTimeout(tapTimer.current)
    tapTimer.current = window.setTimeout(() => {
      setTapping(false)
      taps.current = []
    }, TAP_RESET_MS)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-1.5">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={MIN_BPM}
            max={MAX_BPM}
            value={draft ?? String(bpm)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
              if (e.key === "Escape") {
                cancelled.current = true
                e.currentTarget.blur()
              }
            }}
            className="h-7 w-14 rounded-md border border-input bg-transparent px-1.5 text-right font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30"
          />
          <span className="font-mono text-xs text-muted-foreground">BPM</span>
          <Button
            size="xs"
            variant={tapping ? "secondary" : "outline"}
            onClick={tap}
            title="Tap along to the beat to set the tempo"
            aria-label="Tap tempo"
          >
            <HandIcon /> Tap
          </Button>
        </div>
      </div>
      <Slider
        aria-label={label}
        value={[bpm]}
        min={MIN_BPM}
        max={MAX_BPM}
        step={1}
        onValueChange={([v]) => onChange(v, true)}
      />
      {children}
    </div>
  )
}
