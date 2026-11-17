import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
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
import { Slider } from "@/components/ui/slider"
import type { TrackName } from "@/lib/arrange"
import {
  type EngineStatus,
  type Mix,
  type TrackMix,
  trackGains,
} from "@/lib/audio-engine"
import {
  INSTRUMENTS,
  TRACK_INSTRUMENTS,
  type TrackInstruments,
} from "@/lib/instruments"
import { cn } from "@/lib/utils"

const TRACKS: { id: TrackName; label: string }[] = [
  { id: "chords", label: "Chords" },
  { id: "melody", label: "Melody" },
  { id: "bass", label: "Bass" },
  { id: "drums", label: "Drums" },
]

interface Props {
  instruments: TrackInstruments
  mix: Mix
  reverb: number
  bassEnabled: boolean
  drumsEnabled: boolean
  status: EngineStatus
  onInstrument: (track: TrackName, id: string) => void
  onMix: (track: TrackName, patch: Partial<TrackMix>, coalesce?: string) => void
  onReverb: (value: number) => void
}

export function SoundPanel({
  instruments,
  mix,
  reverb,
  bassEnabled,
  drumsEnabled,
  status,
  onInstrument,
  onMix,
  onReverb,
}: Props) {
  const gains = trackGains(mix)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sound</CardTitle>
        <CardDescription>
          Instruments and mix. Instruments are saved into the MIDI export.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {TRACKS.map(({ id, label }) => {
          const m = mix[id]
          const silent = gains[id] === 0
          const disabled =
            (id === "bass" && !bassEnabled) || (id === "drums" && !drumsEnabled)
          return (
            <div
              key={id}
              className={cn("flex flex-col gap-2", disabled && "opacity-50")}
            >
              <div className="grid grid-cols-[56px_1fr] items-center gap-2">
                <Label htmlFor={`inst-${id}`}>{label}</Label>
                <Select
                  value={instruments[id]}
                  onValueChange={(v) => onInstrument(id, v)}
                >
                  <SelectTrigger id={`inst-${id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACK_INSTRUMENTS[id].map((inst) => (
                      <SelectItem key={inst} value={inst}>
                        {INSTRUMENTS[inst].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-[56px_1fr_auto] items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {Math.round(m.volume * 100)}%
                </span>
                <Slider
                  aria-label={`${label} volume`}
                  className={cn(silent && "opacity-40")}
                  value={[m.volume * 100]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([v]) =>
                    onMix(id, { volume: v / 100 }, `vol-${id}`)
                  }
                />
                <div className="flex gap-1">
                  <Button
                    size="icon-xs"
                    variant={m.mute ? "destructive" : "outline"}
                    aria-label={`Mute ${label}`}
                    aria-pressed={m.mute}
                    title={`Mute ${label}`}
                    onClick={() => onMix(id, { mute: !m.mute })}
                  >
                    M
                  </Button>
                  <Button
                    size="icon-xs"
                    variant={m.solo ? "default" : "outline"}
                    aria-label={`Solo ${label}`}
                    aria-pressed={m.solo}
                    title={`Solo ${label}`}
                    onClick={() => onMix(id, { solo: !m.solo })}
                  >
                    S
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
        <div className="flex flex-col gap-2 border-t pt-3">
          <Label className="flex justify-between">
            Reverb{" "}
            <span className="font-mono text-muted-foreground">
              {Math.round(reverb * 100)}%
            </span>
          </Label>
          <Slider
            aria-label="Reverb"
            value={[reverb * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={([v]) => onReverb(v / 100)}
          />
        </div>
        {status.loading.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Loading {status.loading.join(", ")}…
          </p>
        )}
        {status.failed.length > 0 && (
          <p className="text-xs text-destructive">
            Couldn't download {status.failed.join(", ")} — using the basic synth
            instead.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
