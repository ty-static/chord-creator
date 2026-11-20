import * as React from "react"
import { FileMusicIcon, TriangleAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Song } from "@/lib/arrange"
import { DEFAULT_DRUMS, presetPattern } from "@/lib/drums"
import {
  MAX_IMPORT_BARS,
  type ParsedMidi,
  type PartRole,
  guessKey,
  guessRoles,
  midiToSong,
  partStats,
} from "@/lib/midi-import"
import {
  type Key,
  ROOTS,
  SCALES,
  type ScaleId,
  chordName,
  noteNameWithOctave,
  uid,
} from "@/lib/music"
import { makeSection } from "@/lib/sections"
import {
  ARRANGE_STYLES,
  type ArrangeStyleId,
  applyStyle,
  arrangeStyle,
  styleDrums,
} from "@/lib/styles"

/** The style last used for an arrangement. */
const STYLE_KEY = "chord-creator:arrange-style"
const savedStyle = () => {
  try {
    return arrangeStyle(localStorage.getItem(STYLE_KEY)).id
  } catch {
    return arrangeStyle(null).id
  }
}

export interface PendingImport {
  filename: string
  midi: ParsedMidi
  /**
   * Making an arrangement of a tune: choose a style, which sets the chords,
   * bass, instruments and (if the tune has none) the drums.
   */
  arrange?: boolean
}

interface Props {
  pending: PendingImport | null
  song: Song
  onCancel: () => void
  onImport: (song: Song, label: string) => void
}

const ROLE_LABELS: Record<PartRole, string> = {
  melody: "Melody",
  chords: "Chords",
  bass: "Bass",
  drums: "Drums",
  ignore: "Ignore",
}

export function ImportDialog(props: Props) {
  return (
    <Dialog open={!!props.pending} onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        {props.pending && (
          // Keyed so a new file starts from fresh guesses.
          <ImportForm key={props.pending.filename} {...props} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ImportForm({ pending, song, onCancel, onImport }: Props) {
  const { midi, filename } = pending!
  const [roles, setRoles] = React.useState(() => guessRoles(midi.parts))
  const [key, setKey] = React.useState<Key>(() =>
    guessKey(midi, guessRoles(midi.parts))
  )
  const result = React.useMemo(
    () => midiToSong(midi, roles, key),
    [midi, roles, key]
  )
  const bpm = Math.max(50, Math.min(200, midi.bpm))
  const hasMelody = Object.values(roles).includes("melody")
  const arrange = !!pending!.arrange
  const [styleId, setStyleId] = React.useState<ArrangeStyleId>(savedStyle)
  const style = arrangeStyle(styleId)
  const chooseStyle = (id: ArrangeStyleId) => {
    setStyleId(id)
    try {
      localStorage.setItem(STYLE_KEY, id)
    } catch {
      // Private mode: just not remembered.
    }
  }

  const setRole = (id: string, role: PartRole) =>
    setRoles((r) => {
      const next = { ...r, [id]: role }
      // Only one melody line: the previous one goes back to "ignore".
      if (role === "melody")
        for (const k of Object.keys(next))
          if (k !== id && next[k] === "melody") next[k] = "ignore"
      return next
    })

  const addDrums = arrange && !result.drums && !!style.drums
  const doImport = () => {
    const section = makeSection(
      "Verse",
      result.chords,
      result.melody,
      result.drums ??
        (arrange
          ? styleDrums(style, result.meter)
          : {
              ...DEFAULT_DRUMS,
              enabled: false,
              pattern: presetPattern("pop", result.meter),
            })
    )
    const rest = arrange ? applyStyle(song, style) : { ...song }
    delete rest.meter
    onImport(
      {
        ...rest,
        ...(result.meter !== "4/4" ? { meter: result.meter } : {}),
        key,
        bpm,
        sections: [section],
        arrangement: [{ id: uid(), section: section.id }],
        bass: result.bass || rest.bass,
      },
      `“${filename}”`
    )
  }

  const preview = result.chords.slice(0, 12).map((c) => chordName(c, key))

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileMusicIcon className="size-5" /> Import MIDI file
        </DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">{filename}</span> ·{" "}
          {midi.parts.length} {midi.parts.length === 1 ? "part" : "parts"} ·{" "}
          {midi.bpm} BPM · {midi.timeSig[0]}/{midi.timeSig[1]} · {result.bars}{" "}
          bars
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">
          What is each part?
        </Label>
        <div className="divide-y rounded-lg border">
          {midi.parts.map((p) => {
            const s = partStats(p)
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 px-3 py-2"
                data-part={p.name}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.count} notes
                    {p.isDrums
                      ? " · channel 10"
                      : ` · ${noteNameWithOctave(s.low, key)}–${noteNameWithOctave(s.high, key)}`}
                    {!p.isDrums && s.polyphony > 1.4 && " · chords"}
                  </p>
                </div>
                <Select
                  value={roles[p.id]}
                  onValueChange={(v) => setRole(p.id, v as PartRole)}
                >
                  <SelectTrigger
                    className="w-28"
                    aria-label={`Use ${p.name} as`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as PartRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">
          Key{" "}
          <span className="font-normal">
            ({midi.keySig ? "from the file" : "detected from the notes"})
          </span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={String(key.root)}
            onValueChange={(v) => setKey({ ...key, root: Number(v) })}
          >
            <SelectTrigger className="w-full" aria-label="Import key root">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROOTS.map((r) => (
                <SelectItem key={r.value} value={String(r.value)}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={key.scale}
            onValueChange={(v) => setKey({ ...key, scale: v as ScaleId })}
          >
            <SelectTrigger className="w-full" aria-label="Import scale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SCALES) as ScaleId[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {SCALES[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {arrange && (
        <div className="flex flex-col gap-2">
          <Label
            htmlFor="arrange-style"
            className="text-xs text-muted-foreground"
          >
            Style
          </Label>
          <Select
            value={styleId}
            onValueChange={(v) => chooseStyle(v as ArrangeStyleId)}
          >
            <SelectTrigger id="arrange-style" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARRANGE_STYLES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground" data-style-hint>
            {style.hint}.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">
          You&apos;ll get
        </p>
        <div className="flex flex-wrap gap-1" aria-label="Imported chords">
          {preview.map((name, i) => (
            <Badge key={i} variant="secondary">
              {name}
            </Badge>
          ))}
          {result.chords.length > preview.length && (
            <Badge variant="outline">
              +{result.chords.length - preview.length} more
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground" data-import-summary>
          {result.bars} bars · {result.chords.length} chords ·{" "}
          {hasMelody ? `${result.melody.length} melody notes` : "no melody"} ·{" "}
          {result.drums
            ? "drum beat"
            : addDrums
              ? `${style.label.toLowerCase()} drum beat`
              : "no drums"}{" "}
          · {bpm} BPM
        </p>
        {(result.truncated ||
          result.snapped > 0 ||
          midi.timeSig[0] !== 4 ||
          midi.timeSig[1] !== 4 ||
          bpm !== midi.bpm) && (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {result.truncated && (
              <Warning>
                Only the first {MAX_IMPORT_BARS} bars are imported.
              </Warning>
            )}
            {result.snapped > 0 && (
              <Warning>
                {result.snapped} melody{" "}
                {result.snapped === 1 ? "note was" : "notes were"} outside the
                key and moved onto it.
              </Warning>
            )}
            {(midi.timeSig[0] !== 4 || midi.timeSig[1] !== 4) && (
              <Warning>
                The file is in {midi.timeSig[0]}/{midi.timeSig[1]}; it&apos;s
                read as 4/4.
              </Warning>
            )}
            {bpm !== midi.bpm && <Warning>Tempo limited to {bpm} BPM.</Warning>}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Chords are worked out from the harmony and snapped to the key.{" "}
          {arrange
            ? "The style sets the instruments and how the chords and bass are played; your mix is kept."
            : "Your instruments and mix are kept."}{" "}
          You can undo the import.
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={doImport} disabled={!result.chords.length}>
          Import
        </Button>
      </DialogFooter>
    </>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-amber-500" />
      <span>{children}</span>
    </li>
  )
}
