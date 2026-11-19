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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ChevronDownIcon,
  CopyIcon,
  LogInIcon,
  LogOutIcon,
  CopyPlusIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  SplitIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { sectionColor } from "@/components/section-style"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ENDINGS,
  type Placed,
  type Section,
  type Song,
  sectionMeter,
} from "@/lib/arrange"
import { patternFor } from "@/lib/drums"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { barBeats, meterOf } from "@/lib/meter"
import { uid } from "@/lib/music"
import {
  MAX_SECTIONS,
  MAX_SLOTS,
  SECTION_NAMES,
  addIntro,
  addOutro,
  addSection,
  addSlot,
  copySection,
  formString,
  makeSection,
  makeVariation,
  moveSlot,
  nextSectionName,
  parseForm,
  removeSection,
  removeSlot,
  repeatSlot,
  sectionLetter,
  updateSection,
  variantName,
} from "@/lib/sections"
import { cn } from "@/lib/utils"

interface Props {
  song: Song
  placed: Placed[]
  /** Section open in the editors below. */
  selectedId: string
  /** Slot playing right now, if any. */
  playingSlotId: string | null
  /** Slot being looped, if any. */
  loopSlotId: string | null
  onSelect: (sectionId: string) => void
  onChange: (song: Song) => void
  onLoopSlot: (slotId: string | null) => void
  onPlayFrom: (beat: number) => void
}

export function SongForm({
  song,
  placed,
  selectedId,
  playingSlotId,
  loopSlotId,
  onSelect,
  onChange,
  onLoopSlot,
  onPlayFrom,
}: Props) {
  const [renaming, setRenaming] = React.useState<Section | null>(null)
  const selected = song.sections.find((s) => s.id === selectedId)
  const sectionIndex = new Map(song.sections.map((s, i) => [s.id, i]))
  const fullSections = song.sections.length >= MAX_SECTIONS
  const fullForm = song.arrangement.length >= MAX_SLOTS

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = song.arrangement.findIndex((s) => s.id === active.id)
    const to = song.arrangement.findIndex((s) => s.id === over.id)
    if (from >= 0 && to >= 0) onChange(moveSlot(song, from, to))
  }

  /** Add a brand-new section at the end of the form and open it. */
  const addNew = (section: Section) => {
    onChange(addSection(song, section))
    onSelect(section.id)
  }
  const newEmpty = () =>
    addNew(
      makeSection(
        nextSectionName(song),
        [
          {
            id: uid(),
            degree: 0,
            type: "triad",
            inversion: 0,
            beats: barBeats(meterOf(song.meter)),
          },
        ],
        [],
        drumsLike(selected ?? song.sections[0])
      )
    )
  /** A section's drums, in the song's time (a new section plays in it). */
  const drumsLike = (s: Section) => {
    const drums = structuredClone(s.drums)
    const songMeter = song.meter ?? "4/4"
    if (s.meter && s.meter !== songMeter)
      drums.pattern = patternFor(drums.pattern, s.meter, songMeter)
    return drums
  }

  const placedBySlot = new Map(placed.map((p) => [p.slot.id, p]))

  /** Add a made-up intro or outro and open it. */
  const addEdge = (
    made: { song: Song; section: Section } | null,
    where: string
  ) => {
    if (!made) return
    onChange(made.song)
    onSelect(made.section.id)
    toast.success(`Added ${made.section.name} ${where}`, {
      description:
        "Made from the song's chords, without the melody. Edit it like any section.",
    })
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>Song</CardTitle>
        <CardDescription className="max-sm:hidden">
          Sections play in this order. Drag to reorder; each section has its own
          chords, melody and beat.
        </CardDescription>
        <CardAction>
          <FormField song={song} onChange={onChange} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={song.arrangement.map((s) => s.id)}
            strategy={horizontalListSortingStrategy}
          >
            <ol className="flex flex-wrap items-center gap-1.5">
              {song.arrangement.map((slot, i) => {
                const section = song.sections.find((s) => s.id === slot.section)
                if (!section) return null
                const index = sectionIndex.get(section.id) ?? 0
                const p = placedBySlot.get(slot.id)
                const count = song.arrangement.filter(
                  (s) => s.section === section.id
                ).length
                return (
                  <SlotChip
                    key={slot.id}
                    id={slot.id}
                    position={i + 1}
                    letter={sectionLetter(index)}
                    colorIndex={index}
                    section={section}
                    bars={
                      +(
                        (p?.beats ?? 0) / barBeats(sectionMeter(song, section))
                      ).toFixed(1)
                    }
                    selected={section.id === selectedId}
                    playing={slot.id === playingSlotId}
                    looping={slot.id === loopSlotId}
                    onSelect={() => onSelect(section.id)}
                  >
                    <DropdownMenuLabel>
                      {sectionLetter(index)} · {section.name}
                      {count > 1 && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · plays {count}×
                        </span>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={!p?.beats}
                      onSelect={() => p && onPlayFrom(p.start)}
                    >
                      <PlayIcon /> Play from here
                    </DropdownMenuItem>
                    <DropdownMenuCheckboxItem
                      checked={slot.id === loopSlotId}
                      disabled={!p?.beats}
                      onCheckedChange={(on) => onLoopSlot(on ? slot.id : null)}
                    >
                      Loop this part
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={fullForm}
                      onSelect={() => onChange(repeatSlot(song, slot.id))}
                    >
                      <RepeatIcon /> Repeat
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={fullSections}
                      onSelect={() => {
                        const next = makeVariation(song, slot.id)
                        onChange(next)
                        const copy = next.sections[next.sections.length - 1]
                        onSelect(copy.id)
                        toast.success(`This part now plays ${copy.name}`, {
                          description: `Change it freely — the other ${section.name} parts stay as they are.`,
                        })
                      }}
                    >
                      <SplitIcon /> Make this one a variation
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={song.arrangement.length <= 1}
                      onSelect={() => onChange(removeSlot(song, slot.id))}
                    >
                      <XIcon /> Remove from song
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setRenaming(section)}>
                      <PencilIcon /> Rename {section.name}…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={song.sections.length <= 1}
                      onSelect={() => {
                        onChange(removeSection(song, section.id))
                        toast(`Deleted ${section.name}`, {
                          description:
                            count > 1
                              ? `Removed all ${count} of its parts. Undo with Ctrl+Z.`
                              : "Undo with Ctrl+Z.",
                        })
                      }}
                    >
                      <Trash2Icon /> Delete {section.name}
                    </DropdownMenuItem>
                  </SlotChip>
                )
              })}
              <li>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-dashed"
                    >
                      <PlusIcon /> Add
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuLabel>Play next</DropdownMenuLabel>
                    {song.sections.map((s, i) => (
                      <DropdownMenuItem
                        key={s.id}
                        disabled={fullForm}
                        onSelect={() => {
                          onChange(addSlot(song, s.id))
                          onSelect(s.id)
                        }}
                      >
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded text-[11px] font-bold",
                            sectionColor(i).letter
                          )}
                        >
                          {sectionLetter(i)}
                        </span>
                        {s.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={fullSections || fullForm}
                      onSelect={newEmpty}
                    >
                      <CopyPlusIcon /> New section
                    </DropdownMenuItem>
                    {selected && (
                      <DropdownMenuItem
                        disabled={fullSections || fullForm}
                        onSelect={() =>
                          addNew(copySection(selected, nextSectionName(song)))
                        }
                      >
                        <CopyIcon /> New section from {selected.name}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={fullSections || fullForm}
                      onSelect={() => addEdge(addIntro(song), "at the start")}
                    >
                      <LogInIcon /> Intro, from the first section
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={fullSections || fullForm}
                      onSelect={() => addEdge(addOutro(song), "at the end")}
                    >
                      <LogOutIcon /> Outro, from the last section
                    </DropdownMenuItem>
                    {fullSections && (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        A song can have up to {MAX_SECTIONS} sections.
                      </p>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
              <li className="ml-auto">
                <Select
                  value={song.ending ?? "none"}
                  onValueChange={(v) => {
                    const ending = ENDINGS.find((e) => e.value === v)
                    onChange({ ...song, ending: ending?.value })
                    if (ending)
                      toast(`Ending: ${ending.label}`, {
                        description: `${ending.hint}. It plays when the song isn't looping.`,
                      })
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Ending: ${ENDINGS.find((e) => e.value === song.ending)?.label ?? "None"}`}
                    title={
                      ENDINGS.find((e) => e.value === song.ending)?.hint ??
                      "The song just stops after the last section"
                    }
                    className="h-8 border-dashed"
                  >
                    <span className="text-muted-foreground">Ending:</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="none">None</SelectItem>
                    {ENDINGS.map((e) => (
                      <SelectItem key={e.value} value={e.value} title={e.hint}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            </ol>
          </SortableContext>
        </DndContext>
      </CardContent>
      <RenameDialog
        section={renaming}
        song={song}
        onClose={() => setRenaming(null)}
        onRename={(name) => {
          if (renaming) onChange(updateSection(song, renaming.id, { name }))
          setRenaming(null)
        }}
      />
    </Card>
  )
}

function SlotChip({
  id,
  position,
  letter,
  colorIndex,
  section,
  bars,
  selected,
  playing,
  looping,
  onSelect,
  children,
}: {
  id: string
  position: number
  letter: string
  colorIndex: number
  section: Section
  bars: number
  selected: boolean
  playing: boolean
  looping: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  const color = sectionColor(colorIndex)
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        position: "relative",
      }}
      className={cn(
        "flex h-8 items-center rounded-md border text-sm transition-shadow",
        color.chip,
        selected && "ring-2 ring-ring",
        isDragging && "shadow-lg"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-roledescription="sortable"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex h-full cursor-grab items-center gap-1.5 rounded-l-md pr-1 pl-1 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded text-[11px] font-bold",
            color.letter
          )}
        >
          {letter}
        </span>
        <span className="max-w-28 truncate font-medium">{section.name}</span>
        <span className="text-xs text-muted-foreground">
          {bars}
          <span className="sr-only"> {bars === 1 ? "bar" : "bars"}</span>
        </span>
        {/* The name reads e.g. "A Verse 4 bars, part 1 of the form…". */}
        <span className="sr-only">
          , part {position} of the form
          {playing ? ", playing" : ""}
          {looping ? ", looping" : ""}. Click to edit, drag to move.
        </span>
        {playing && (
          <span
            className="size-1.5 animate-pulse rounded-full bg-destructive"
            aria-hidden
          />
        )}
        {looping && <RepeatIcon className="size-3 text-primary" aria-hidden />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${section.name} options`}
            className="flex h-full min-w-6 items-center justify-center rounded-r-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** The form as letters ("A A B A"), editable by typing. */
function FormField({
  song,
  onChange,
}: {
  song: Song
  onChange: (song: Song) => void
}) {
  const form = formString(song)
  const [draft, setDraft] = React.useState<string | null>(null)
  const apply = () => {
    if (draft === null) return
    setDraft(null)
    if (draft.replace(/\s/g, "").toUpperCase() === form.replace(/\s/g, ""))
      return
    const result = parseForm(song, draft)
    if ("error" in result)
      return toast.error("Couldn't use that form", {
        description: result.error,
      })
    onChange({ ...song, arrangement: result.slots })
  }
  if (draft !== null)
    return (
      <input
        autoFocus
        aria-label="Song form as letters"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply()
          if (e.key === "Escape") setDraft(null)
        }}
        className="h-7 w-36 rounded-md border bg-background px-2 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 max-w-44 font-mono"
      title="Type the form as letters, e.g. A A B A"
      onClick={() => setDraft(form)}
    >
      <span className="truncate">{form}</span>
      <PencilIcon className="size-3 opacity-60" />
    </Button>
  )
}

function RenameDialog({
  section,
  song,
  onClose,
  onRename,
}: {
  section: Section | null
  song: Song
  onClose: () => void
  onRename: (name: string) => void
}) {
  const [name, setName] = React.useState("")
  const inputId = React.useId()
  const [prev, setPrev] = React.useState<Section | null>(null)
  if (section !== prev) {
    setPrev(section)
    if (section) setName(section.name)
  }
  const used = new Set(
    song.sections.filter((s) => s.id !== section?.id).map((s) => s.name)
  )
  const trimmed = name.trim().slice(0, 24)
  const submit = () => {
    if (!trimmed) return
    onRename(used.has(trimmed) ? variantName(song, trimmed) : trimmed)
  }
  return (
    <Dialog open={!!section} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename section</DialogTitle>
          <DialogDescription>Pick a name or type your own.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            id={inputId}
            aria-label="Section name"
            autoFocus
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap gap-1.5">
            {SECTION_NAMES.map((n) => (
              <Button
                key={n}
                type="button"
                size="xs"
                variant={n === trimmed ? "secondary" : "outline"}
                onClick={() => setName(n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
