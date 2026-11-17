import { EraserIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  DRUM_PIECES,
  DRUM_PRESETS,
  DRUM_STEPS,
  DRUM_STEPS_PER_BEAT,
  type DrumPiece,
  type DrumSettings,
  FILL_STYLES,
  type FillStyle,
  type StepValue,
  emptyPattern,
  matchingPreset,
  presetPattern,
} from "@/lib/drums"
import { cn } from "@/lib/utils"

interface Props {
  drums: DrumSettings
  onChange: (drums: DrumSettings) => void
  /** Current playhead position in beats, or null when stopped. */
  playheadBeat: number | null
  onPreview: (midi: number) => void
  /** Song-wide: a crash wherever the form moves to a new section. */
  crashOnChange: boolean
  onCrashOnChange: (on: boolean) => void
}

const NEXT: Record<StepValue, StepValue> = { 0: 1, 1: 2, 2: 0 }

export function DrumEditor({
  drums,
  onChange,
  playheadBeat,
  onPreview,
  crashOnChange,
  onCrashOnChange,
}: Props) {
  const preset = matchingPreset(drums.pattern)
  const set = (p: Partial<DrumSettings>) => onChange({ ...drums, ...p })
  const playStep =
    playheadBeat === null
      ? -1
      : Math.floor(playheadBeat * DRUM_STEPS_PER_BEAT) % DRUM_STEPS

  const toggle = (piece: DrumPiece, step: number, midi: number) => {
    const row = [...drums.pattern[piece]]
    row[step] = NEXT[row[step]]
    if (row[step]) onPreview(midi)
    set({ enabled: true, pattern: { ...drums.pattern, [piece]: row } })
  }

  return (
    <Card>
      <CardHeader className="max-sm:flex max-sm:flex-col">
        <CardTitle>Drums</CardTitle>
        <CardDescription>
          A one-bar beat that repeats under your song. Click a step to add a
          hit, click again to accent it, once more to clear.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Label htmlFor="drums-on" className="text-sm">
            {drums.enabled ? "On" : "Off"}
          </Label>
          <Switch
            id="drums-on"
            aria-label="Drums on"
            checked={drums.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={preset ?? "custom"}
            onValueChange={(id) =>
              id !== "custom" &&
              set({ enabled: true, pattern: presetPattern(id) })
            }
          >
            <SelectTrigger className="w-44" aria-label="Drum pattern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRUM_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
              {!preset && <SelectItem value="custom">Custom</SelectItem>}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => set({ pattern: emptyPattern() })}
          >
            <EraserIcon /> Clear
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <Select
              value={drums.fill ? (drums.fillStyle ?? "snare") : "none"}
              onValueChange={(v) =>
                set(
                  v === "none"
                    ? { fill: false }
                    : {
                        fill: true,
                        fillStyle: v === "snare" ? undefined : (v as FillStyle),
                      }
                )
              }
            >
              <SelectTrigger
                size="sm"
                className="w-36"
                aria-label="Fill at the end of this section"
                title="A fill at the end of this section, every time it plays"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No fill</SelectItem>
                {FILL_STYLES.map((f) => (
                  <SelectItem key={f.value} value={f.value} title={f.hint}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={drums.crashAtStart}
                onCheckedChange={(crashAtStart) => set({ crashAtStart })}
              />
              Crash at start
            </label>
            <label
              className="flex items-center gap-2 text-sm"
              title="For the whole song: a crash wherever the form moves to a different section"
            >
              <Switch
                checked={crashOnChange}
                onCheckedChange={onCrashOnChange}
              />
              Crash on every new section
            </label>
          </div>
        </div>

        <div
          className={cn(
            "overflow-x-auto transition-opacity",
            !drums.enabled && "opacity-50"
          )}
        >
          <div
            className="grid min-w-[560px] gap-1"
            style={{
              gridTemplateColumns: `88px repeat(${DRUM_STEPS}, minmax(24px, 1fr))`,
            }}
            role="grid"
            aria-label="Drum steps"
          >
            <div />
            {Array.from({ length: DRUM_STEPS }, (_, s) => (
              <div
                key={s}
                className={cn(
                  "text-center font-mono text-[10px] text-muted-foreground",
                  s % DRUM_STEPS_PER_BEAT === 0 &&
                    "font-semibold text-foreground"
                )}
              >
                {s % DRUM_STEPS_PER_BEAT === 0
                  ? s / DRUM_STEPS_PER_BEAT + 1
                  : "·"}
              </div>
            ))}
            {DRUM_PIECES.map((piece) => (
              <div key={piece.id} role="row" className="contents">
                <button
                  type="button"
                  className="truncate rounded px-1 text-left text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onPreview(piece.midi)}
                  title={`Preview ${piece.label}`}
                >
                  {piece.label}
                </button>
                {drums.pattern[piece.id].map((v, s) => (
                  <button
                    key={s}
                    type="button"
                    role="gridcell"
                    aria-label={`${piece.label} step ${s + 1}`}
                    aria-pressed={v > 0}
                    data-value={v}
                    onClick={() => toggle(piece.id, s, piece.midi)}
                    className={cn(
                      "h-7 rounded-sm border transition-colors",
                      Math.floor(s / DRUM_STEPS_PER_BEAT) % 2 === 0
                        ? "bg-muted/40"
                        : "bg-muted",
                      v === 1 && "border-primary/60 bg-primary/50",
                      v === 2 && "border-primary bg-primary",
                      s === playStep && "ring-2 ring-ring",
                      v === 0 && "hover:bg-accent"
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Drums export on MIDI channel 10 (General MIDI percussion), so any DAW
          drum kit plays them.
        </p>
      </CardContent>
    </Card>
  )
}
