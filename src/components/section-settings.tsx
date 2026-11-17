import {
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  type ChordStyle,
  MAX_ENERGY,
  MAX_TRANSPOSE,
  MIN_ENERGY,
  type Section,
  type TrackName,
  hasSectionStyle,
} from "@/lib/arrange"
import { BASS_STYLES, type BassStyle, bassLabel } from "@/lib/bass"
import { type Key, keyLabel, sectionKey } from "@/lib/music"
import type { SetOptions } from "@/lib/use-history"

const STYLE_LABELS: Record<ChordStyle, string> = {
  block: "Block",
  pulse: "Pulse",
  arpeggio: "Arp",
}
const TRACK_LABELS: Record<TrackName, string> = {
  chords: "Chords",
  melody: "Melody",
  bass: "Bass",
  drums: "Drums",
}

const semitones = (n: number) =>
  `${n > 0 ? "+" : "−"}${Math.abs(n)} ${Math.abs(n) === 1 ? "semitone" : "semitones"}`

/** Short notes on how a section differs from the song, e.g. "no drums". */
export function sectionStyleSummary(
  section: Section,
  {
    bass,
    anyDrums,
    musicKey,
  }: { bass: boolean; anyDrums: boolean; musicKey?: Key }
) {
  const out: string[] = []
  const silent = [
    ...(section.tacet ?? []).filter((t) => t !== "bass" || bass),
    ...(section.drums.enabled || !anyDrums ? [] : (["drums"] as TrackName[])),
  ]
  if (silent.length)
    out.push(
      `no ${silent.map((t) => TRACK_LABELS[t].toLowerCase()).join(", ")}`
    )
  if (section.chordStyle)
    out.push(STYLE_LABELS[section.chordStyle].toLowerCase())
  if (section.bassStyle && bass)
    out.push(`${bassLabel(section.bassStyle).toLowerCase()} bass`)
  const energy = section.energy ?? 1
  if (energy !== 1) out.push(energy < 1 ? "softer" : "louder")
  if (section.transpose)
    out.push(
      musicKey
        ? `in ${keyLabel(sectionKey(musicKey, section.transpose))}`
        : semitones(section.transpose)
    )
  if (section.buildUp) out.push("build-up")
  return out
}

type Patch = Partial<
  Pick<
    Section,
    | "tacet"
    | "chordStyle"
    | "bassStyle"
    | "energy"
    | "transpose"
    | "buildUp"
    | "drums"
  >
>

export function SectionSettings({
  section,
  musicKey,
  songChordStyle,
  songBassStyle,
  bass,
  onChange,
}: {
  section: Section
  musicKey: Key
  songChordStyle: ChordStyle
  songBassStyle: BassStyle
  /** Whether the song has a bass line at all. */
  bass: boolean
  onChange: (patch: Patch, opts?: SetOptions) => void
}) {
  const tacet = section.tacet ?? []
  // Drums already have an on/off switch per section; use it here too.
  const playing = (["chords", "melody", "bass", "drums"] as TrackName[]).filter(
    (t) => (t === "drums" ? section.drums.enabled : !tacet.includes(t))
  )
  const energy = section.energy ?? 1
  const transpose = section.transpose ?? 0
  const changed = hasSectionStyle(section)

  const setTracks = (next: string[]) => {
    const tracks = next as TrackName[]
    const off = (["chords", "melody", "bass"] as TrackName[]).filter(
      (t) => !tracks.includes(t)
    )
    const drumsOn = tracks.includes("drums")
    onChange({
      tacet: off.length ? off : undefined,
      ...(drumsOn !== section.drums.enabled
        ? { drums: { ...section.drums, enabled: drumsOn } }
        : {}),
    })
  }
  const setTranspose = (n: number) =>
    onChange({ transpose: n || undefined }, { coalesce: "transpose" })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative"
          title="Which tracks play, chord rhythm, energy and key change for this section"
        >
          <SlidersHorizontalIcon /> Section style
          {changed && (
            <span
              className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary"
              aria-label="(changed)"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-4">
        <div>
          <p className="font-heading font-semibold">How {section.name} plays</p>
          <p className="text-xs text-muted-foreground">
            Changes here apply every time this section plays.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Tracks</Label>
          <ToggleGroup
            type="multiple"
            variant="outline"
            className="w-full"
            value={playing}
            onValueChange={setTracks}
          >
            {(Object.keys(TRACK_LABELS) as TrackName[]).map((t) => (
              <ToggleGroupItem
                key={t}
                value={t}
                className="flex-1 text-xs"
                disabled={t === "bass" && !bass}
                title={
                  t === "bass" && !bass
                    ? "The bass line is off for the whole song"
                    : undefined
                }
              >
                {TRACK_LABELS[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Chord rhythm</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            className="w-full"
            value={section.chordStyle ?? "song"}
            onValueChange={(v) =>
              v &&
              onChange({
                chordStyle: v === "song" ? undefined : (v as ChordStyle),
              })
            }
          >
            <ToggleGroupItem
              value="song"
              className="flex-1 text-xs"
              title={`Use the song's rhythm (${STYLE_LABELS[songChordStyle]})`}
            >
              Song
            </ToggleGroupItem>
            {(Object.keys(STYLE_LABELS) as ChordStyle[]).map((s) => (
              <ToggleGroupItem key={s} value={s} className="flex-1 text-xs">
                {STYLE_LABELS[s]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Bass pattern</Label>
          <Select
            value={section.bassStyle ?? "song"}
            disabled={!bass}
            onValueChange={(v) =>
              onChange({
                bassStyle: v === "song" ? undefined : (v as BassStyle),
              })
            }
          >
            <SelectTrigger
              aria-label="Bass pattern for this section"
              className="w-full"
              title={
                bass ? undefined : "The bass line is off for the whole song"
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="song">
                Song ({bassLabel(songBassStyle)})
              </SelectItem>
              {BASS_STYLES.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="flex justify-between">
            Energy
            <span className="font-mono text-muted-foreground">
              {energy === 1 ? "as written" : `${Math.round(energy * 100)}%`}
            </span>
          </Label>
          <Slider
            aria-label="Energy"
            value={[energy]}
            min={MIN_ENERGY}
            max={MAX_ENERGY}
            step={0.05}
            onValueChange={([v]) =>
              onChange(
                { energy: Math.abs(v - 1) < 0.001 ? undefined : v },
                { coalesce: "energy" }
              )
            }
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Softer</span>
            <span>Louder</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="build-up"
            className="flex flex-col items-start gap-0.5"
          >
            Build-up
            <span className="text-xs font-normal text-muted-foreground">
              Gets louder over the last bars, into the next section
            </span>
          </Label>
          <Switch
            id="build-up"
            checked={!!section.buildUp}
            onCheckedChange={(on) => onChange({ buildUp: on || undefined })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Key change</Label>
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Key change down a semitone"
              disabled={transpose <= -MAX_TRANSPOSE}
              onClick={() => setTranspose(transpose - 1)}
            >
              <MinusIcon />
            </Button>
            <span className="flex-1 text-center text-sm" aria-live="polite">
              {transpose ? (
                <>
                  {semitones(transpose)}
                  <span className="text-muted-foreground">
                    {" "}
                    · {keyLabel(sectionKey(musicKey, transpose))}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  None · {keyLabel(musicKey)}
                </span>
              )}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Key change up a semitone"
              disabled={transpose >= MAX_TRANSPOSE}
              onClick={() => setTranspose(transpose + 1)}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>

        {changed && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              onChange({
                tacet: undefined,
                chordStyle: undefined,
                bassStyle: undefined,
                energy: undefined,
                transpose: undefined,
                buildUp: undefined,
              })
            }
          >
            <RotateCcwIcon /> Play as the rest of the song
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
