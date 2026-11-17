import * as React from "react"
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  PlusIcon,
  ShuffleIcon,
  Trash2Icon,
  Volume2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
import { cn } from "@/lib/utils"
import {
  CHORD_TYPES,
  type Chord,
  type ChordType,
  type Key,
  PRESETS,
  chordMidi,
  chordName,
  chordsFromPreset,
  keyLabel,
  noteNameWithOctave,
  randomProgression,
  romanNumeral,
  uid,
  type Voicing,
} from "@/lib/music"

interface Props {
  musicKey: Key
  chords: Chord[]
  onChange: (chords: Chord[]) => void
  activeChordId: string | null
  onPreview: (midis: number[]) => void
  /** Actual notes played for each chord (after voice leading). */
  voicings: Voicing[]
  voiceLeading: boolean
}

const BEAT_OPTIONS = [1, 2, 4, 8]

export function ChordEditor({
  musicKey,
  chords,
  onChange,
  activeChordId,
  onPreview,
  voicings,
  voiceLeading,
}: Props) {
  const update = (id: string, patch: Partial<Chord>) =>
    onChange(chords.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const move = (index: number, dir: -1 | 1) => {
    const next = [...chords]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  // On phones, cards show just the chord until expanded.
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = chords.findIndex((c) => c.id === active.id)
    const to = chords.findIndex((c) => c.id === over.id)
    if (from >= 0 && to >= 0) onChange(arrayMove(chords, from, to))
  }

  const addChord = (degree: number, type: ChordType = "triad") => {
    const chord: Chord = { id: uid(), degree, type, inversion: 0, beats: 4 }
    onChange([...chords, chord])
    onPreview(chordMidi(chord, musicKey))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="max-sm:flex max-sm:flex-col">
          <CardTitle>Diatonic chords — {keyLabel(musicKey)}</CardTitle>
          <CardDescription>
            Click a chord to add it to your progression.
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-2">
            <Select
              onValueChange={(id) => {
                const preset = PRESETS.find((p) => p.id === id)
                if (preset) onChange(chordsFromPreset(preset))
              }}
            >
              <SelectTrigger
                className="w-52"
                aria-label="Load a preset progression"
              >
                <SelectValue placeholder="Load a preset…" />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() =>
                onChange(randomProgression(4, Math.random() < 0.4))
              }
            >
              <ShuffleIcon /> Randomize
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {Array.from({ length: 7 }, (_, degree) => {
              const chord = { degree, type: "triad" as const, inversion: 0 }
              return (
                <Button
                  key={degree}
                  variant="secondary"
                  className="h-auto flex-col gap-0.5 py-3"
                  onClick={() => addChord(degree)}
                >
                  <span className="text-base font-semibold">
                    {chordName(chord, musicKey)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {romanNumeral(chord, musicKey)}
                  </span>
                </Button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={chords.map((c) => c.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-3">
            {chords.map((chord, i) => {
              const voicing = voicings[i] ?? {
                notes: chordMidi(chord, musicKey),
                inversion: chord.inversion,
              }
              const notes = voicing.notes
              const autoInversion = voiceLeading && i > 0
              const shown = { ...chord, inversion: voicing.inversion }
              const active = chord.id === activeChordId
              return (
                <SortableItem
                  key={chord.id}
                  id={chord.id}
                  className={cn(
                    expanded === chord.id && "col-span-2 sm:col-span-1"
                  )}
                >
                  {(handle, dragging) => (
                    <Card
                      className={cn(
                        "gap-3 transition-shadow",
                        active && "ring-2 ring-primary",
                        dragging && "shadow-xl ring-2 ring-primary/60"
                      )}
                      size="sm"
                    >
                      <CardHeader>
                        <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <button
                            type="button"
                            {...handle}
                            aria-label={`Drag to reorder chord ${i + 1}`}
                            title="Drag to reorder"
                            className="-ml-1 cursor-grab touch-none rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
                          >
                            <GripVerticalIcon className="size-4" />
                          </button>
                          <span>#{i + 1}</span>
                          <Badge variant="outline">
                            {romanNumeral(chord, musicKey)}
                          </Badge>
                          <span className="hidden whitespace-nowrap sm:inline">
                            {chord.beats} {chord.beats === 1 ? "beat" : "beats"}
                          </span>
                        </CardDescription>
                        <CardTitle className="text-2xl! font-semibold">
                          {chordName(shown, musicKey)}
                        </CardTitle>
                        <CardAction className="flex">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="sm:hidden"
                            aria-label={
                              expanded === chord.id
                                ? "Collapse chord"
                                : "Edit chord"
                            }
                            aria-expanded={expanded === chord.id}
                            onClick={() =>
                              setExpanded((e) =>
                                e === chord.id ? null : chord.id
                              )
                            }
                          >
                            <ChevronDownIcon
                              className={cn(
                                "transition-transform",
                                expanded === chord.id && "rotate-180"
                              )}
                            />
                          </Button>

                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Preview chord"
                            onClick={() => onPreview(notes)}
                          >
                            <Volume2Icon />
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-1">
                          {notes.map((m, j) => (
                            <Badge
                              key={j}
                              variant="secondary"
                              className="font-mono"
                            >
                              {noteNameWithOctave(m, musicKey)}
                            </Badge>
                          ))}
                        </div>
                        <div
                          className={cn(
                            "grid-cols-2 gap-2 sm:grid",
                            expanded === chord.id ? "grid" : "hidden"
                          )}
                        >
                          <Field label="Degree">
                            <Select
                              value={String(chord.degree)}
                              onValueChange={(v) =>
                                update(chord.id, { degree: Number(v) })
                              }
                            >
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 7 }, (_, d) => (
                                  <SelectItem key={d} value={String(d)}>
                                    {romanNumeral(
                                      { degree: d, type: chord.type },
                                      musicKey
                                    )}{" "}
                                    ·{" "}
                                    {chordName(
                                      {
                                        degree: d,
                                        type: chord.type,
                                        inversion: 0,
                                      },
                                      musicKey
                                    )}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="Type">
                            <Select
                              value={chord.type}
                              onValueChange={(v) =>
                                update(chord.id, {
                                  type: v as ChordType,
                                  inversion: 0,
                                })
                              }
                            >
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CHORD_TYPES.map((t) => (
                                  <SelectItem key={t.value} value={t.value}>
                                    {t.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field
                            label={
                              autoInversion ? "Inversion (auto)" : "Inversion"
                            }
                          >
                            <Select
                              disabled={autoInversion}
                              value={String(voicing.inversion)}
                              onValueChange={(v) =>
                                update(chord.id, { inversion: Number(v) })
                              }
                            >
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["Root", "1st", "2nd", "3rd"]
                                  .slice(0, notes.length)
                                  .map((label, n) => (
                                    <SelectItem key={n} value={String(n)}>
                                      {label}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="Length">
                            <Select
                              value={String(chord.beats)}
                              onValueChange={(v) =>
                                update(chord.id, { beats: Number(v) })
                              }
                            >
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {BEAT_OPTIONS.map((b) => (
                                  <SelectItem key={b} value={String(b)}>
                                    {b} {b === 1 ? "beat" : "beats"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        </div>
                        <div
                          className={cn(
                            "items-center justify-between sm:flex",
                            expanded === chord.id ? "flex" : "hidden"
                          )}
                        >
                          <div className="flex gap-1">
                            <Button
                              size="icon-sm"
                              variant="outline"
                              aria-label="Move left"
                              disabled={i === 0}
                              onClick={() => move(i, -1)}
                            >
                              <ArrowLeftIcon />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="outline"
                              aria-label="Move right"
                              disabled={i === chords.length - 1}
                              onClick={() => move(i, 1)}
                            >
                              <ArrowRightIcon />
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              onChange(chords.filter((c) => c.id !== chord.id))
                            }
                          >
                            <Trash2Icon /> Remove
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </SortableItem>
              )
            })}
            <button
              type="button"
              onClick={() => addChord(0)}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground sm:min-h-40"
            >
              <PlusIcon className="size-5" />
              Add chord
            </button>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

type HandleProps = ReturnType<typeof useSortable>["attributes"] &
  NonNullable<ReturnType<typeof useSortable>["listeners"]>

function SortableItem({
  id,
  children,
  className,
}: {
  id: string
  className?: string
  children: (handle: HandleProps, dragging: boolean) => React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className={className}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        position: "relative",
      }}
    >
      {children({ ...attributes, ...listeners } as HandleProps, isDragging)}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
