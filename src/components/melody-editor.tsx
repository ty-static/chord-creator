import * as React from "react"
import {
  ChevronDownIcon,
  CopyIcon,
  EraserIcon,
  Link2Icon,
  LockIcon,
  LockOpenIcon,
  RefreshCwIcon,
  Repeat2Icon,
  RepeatIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { KeyboardInputBar } from "@/components/midi-keyboard"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { foldDegree, nearestDegree } from "@/lib/harmony"
import { type MidiNoteEvent, midiInput } from "@/lib/midi-input"
import {
  BORROW_MODES,
  type BorrowMode,
  borrowMelody,
  leadInto,
} from "@/lib/melody-links"
import { cn } from "@/lib/utils"
import {
  type Chord,
  type Key,
  MELODY_RANGE,
  type MelodyNote,
  STEPS_PER_BAR as STEPS_PER_BAR_44,
  STEPS_PER_BEAT,
  chordName,
  clearBar,
  degreeToMidi,
  generateAroundLocked,
  lockBar,
  overlaps,
  regenerateBar,
  repeatBar,
  melodyBase,
  noteNameWithOctave,
  totalBeats,
  uid,
} from "@/lib/music"

/** Another section whose melody can be reused here. */
export interface MelodySource {
  id: string
  label: string
  chords: Chord[]
  melody: MelodyNote[]
}

/** A section that follows this one in the form, and its first note. */
export interface LeadTarget {
  id: string
  label: string
  /** The next section's first melody note, as a degree in this section's key. */
  degree: number
}

interface Props {
  musicKey: Key
  /** Other sections with a melody, for "Melody from another section". */
  sources?: MelodySource[]
  /** Sections that come next in the form, for "Lead into". */
  leadTargets?: LeadTarget[]
  chords: Chord[]
  melody: MelodyNote[]
  onChange: (melody: MelodyNote[]) => void
  playheadBeat: number | null
  onPreview: (midi: number) => void
  /** Eighth notes in a bar of the song's time signature (8 in 4/4). */
  barSteps?: number
}

const CELL_W = 28
const CELL_H = 22
const RULER_H = 24

type DragMode = "move" | "resize" | "create"

interface Drag {
  mode: DragMode
  pointerId: number
  orig: MelodyNote
  grabStep: number
  grabDegree: number
  moved: boolean
}

/** Keys aimed at these elements are left alone (typing, sliders, menus…). */
const KEY_EXEMPT =
  "input, textarea, select, [contenteditable=true], [role=slider], [role=combobox], [role=option], [role=tab], [role=radio], [role=menuitem]"

/** A fresh seed for the melody generator (outside render, for the React lint). */
const randomSeed = () => Math.floor(Math.random() * 1e9)

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

/**
 * Insert `note` into `others`, trimming/removing anything it overlaps (melody
 * is monophonic). Returns null if it would overwrite a locked note.
 */
function place(others: MelodyNote[], note: MelodyNote) {
  if (others.some((n) => n.locked && overlaps(n, note))) return null
  const end = note.start + note.length
  const kept = others
    .filter((n) => n.start < note.start || n.start >= end)
    .map((n) =>
      n.start < note.start && n.start + n.length > note.start
        ? { ...n, length: note.start - n.start }
        : n
    )
  return [...kept, note].sort((a, b) => a.start - b.start)
}

export function MelodyEditor({
  musicKey,
  sources = [],
  leadTargets = [],
  chords,
  melody,
  onChange,
  playheadBeat,
  onPreview,
  barSteps: STEPS_PER_BAR = STEPS_PER_BAR_44,
}: Props) {
  const [density, setDensity] = React.useState(55)
  const [newLength, setNewLength] = React.useState("2")
  const [drag, setDrag] = React.useState<Drag | null>(null)
  const [draft, setDraft] = React.useState<MelodyNote[] | null>(null)
  const [selectedRaw, setSelected] = React.useState<string | null>(null)
  const selectedNote = melody.find((n) => n.id === selectedRaw) ?? null
  const selected = selectedNote?.id ?? null
  const gridRef = React.useRef<HTMLDivElement>(null)

  // Step input from a MIDI keyboard: each key press adds a note at the cursor.
  const [stepInput, setStepInput] = React.useState(false)
  const [cursor, setCursorState] = React.useState(0)
  const cursorRef = React.useRef(0)
  /** Melody we just sent up, before the parent re-renders with it. */
  const pendingRef = React.useRef<MelodyNote[] | null>(null)
  const lastStepRef = React.useRef<{
    time: number
    id: string
    pitch: number
  } | null>(null)
  React.useEffect(() => {
    pendingRef.current = null
  }, [melody])
  const setCursor = (step: number) => {
    cursorRef.current = step
    setCursorState(step)
  }

  const totalSteps = totalBeats(chords) * STEPS_PER_BEAT
  const base = melodyBase(musicKey)
  const rows = Array.from(
    { length: MELODY_RANGE },
    (_, i) => MELODY_RANGE - 1 - i
  )
  const notes = draft ?? melody
  const midiOf = (degree: number) => degreeToMidi(degree, musicKey, base)

  const genOpts = () => ({
    density: density / 100,
    scale: musicKey.scale,
    seed: randomSeed(),
    barSteps: STEPS_PER_BAR,
  })
  const generate = () =>
    onChange(generateAroundLocked(melody, chords, genOpts()))
  const lockedCount = melody.filter((n) => n.locked).length
  const borrow = (src: MelodySource, mode: BorrowMode) => {
    onChange(borrowMelody(src, { chords, melody }, mode, genOpts()))
    toast.success(`Melody from ${src.label}`, {
      description: BORROW_MODES.find((m) => m.id === mode)?.hint,
    })
  }
  const leadIn = (t: LeadTarget) => {
    const next = leadInto(melody, chords, t.degree)
    if (!next) {
      toast.error("Couldn't add a lead-in", {
        description:
          totalSteps < 7
            ? "This section is too short."
            : "A locked note is in the last beat and a half. Unlock it first.",
      })
      return
    }
    onChange(next)
    toast.success(`Leads into ${t.label}`, {
      description: "The last beat and a half now steps into its first note.",
    })
  }
  const canLink =
    chords.length > 0 && (sources.length > 0 || leadTargets.length > 0)
  const bars = Math.ceil(totalSteps / STEPS_PER_BAR)
  const barNotes = (bar: number) =>
    melody.filter(
      (n) =>
        n.start >= bar * STEPS_PER_BAR && n.start < (bar + 1) * STEPS_PER_BAR
    )
  const allBars = Array.from({ length: bars }, (_, i) => i)
  const toggleStepInput = (on: boolean) => {
    setStepInput(on)
    lastStepRef.current = null
    if (on)
      setCursor(
        selectedNote
          ? Math.min(selectedNote.start + selectedNote.length, totalSteps)
          : 0
      )
  }
  const stepLength = () => Number(newLength)

  const onMidiNote = React.useEffectEvent((e: MidiNoteEvent) => {
    if (!stepInput || e.type !== "on" || !totalSteps) return
    const current = pendingRef.current ?? melody
    const degree = foldDegree(nearestDegree(e.note, musicKey))
    const now = performance.now()
    const last = lastStepRef.current
    if (last && now - last.time < 60) {
      // Several keys at once (a chord): keep the top note.
      if (e.note <= last.pitch) return
      const next = current.map((n) => (n.id === last.id ? { ...n, degree } : n))
      lastStepRef.current = { ...last, pitch: e.note }
      pendingRef.current = next
      onChange(next)
      return
    }
    const start = cursorRef.current
    if (start >= totalSteps) {
      toast("Reached the end of the song", {
        description: "Press Restart to record from the beginning.",
      })
      return
    }
    const note: MelodyNote = {
      id: uid(),
      start,
      length: Math.min(stepLength(), totalSteps - start),
      degree,
    }
    setCursor(start + note.length)
    const placed = place(current, note)
    if (!placed) return // a locked note is in the way: skip over it
    lastStepRef.current = { time: now, id: note.id, pitch: e.note }
    pendingRef.current = placed
    onChange(placed)
    setSelected(note.id)
  })
  React.useEffect(() => midiInput.onNote((e) => onMidiNote(e)), [])

  const toggleLock = (id: string) =>
    onChange(melody.map((n) => (n.id === id ? { ...n, locked: !n.locked } : n)))

  const cellFromEvent = (e: React.PointerEvent) => {
    const rect = gridRef.current!.getBoundingClientRect()
    return {
      step: clamp(
        Math.floor((e.clientX - rect.left) / CELL_W),
        0,
        totalSteps - 1
      ),
      degree: clamp(
        MELODY_RANGE - 1 - Math.floor((e.clientY - rect.top) / CELL_H),
        0,
        MELODY_RANGE - 1
      ),
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !totalSteps) return
    const target = e.target as HTMLElement
    const noteEl = target.closest<HTMLElement>("[data-note-id]")
    const { step, degree } = cellFromEvent(e)
    let next: Drag

    if (noteEl) {
      const note = melody.find((n) => n.id === noteEl.dataset.noteId)
      if (!note) return
      if (note.locked) {
        // Locked notes can be selected (and unlocked) but not dragged.
        setSelected(note.id)
        if (stepInput) setCursor(Math.min(note.start + note.length, totalSteps))
        onPreview(midiOf(note.degree))
        return
      }
      const mode: DragMode = target.closest("[data-resize]") ? "resize" : "move"
      next = {
        mode,
        pointerId: e.pointerId,
        orig: note,
        grabStep: step,
        grabDegree: degree,
        moved: false,
      }
      setDraft(melody)
    } else {
      const note: MelodyNote = {
        id: uid(),
        start: step,
        length: Math.min(Number(newLength), totalSteps - step),
        degree,
      }
      next = {
        mode: "create",
        pointerId: e.pointerId,
        orig: note,
        grabStep: step,
        grabDegree: degree,
        moved: false,
      }
      const placed = place(melody, note)
      if (!placed) return
      setSelected(note.id)
      setDraft(placed)
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer already gone */
    }
    e.preventDefault()
    setDrag(next)
    if (next.mode !== "resize") onPreview(midiOf(next.orig.degree))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const { step, degree } = cellFromEvent(e)
    const { orig } = drag
    let note: MelodyNote

    if (drag.mode === "move") {
      note = {
        ...orig,
        start: clamp(
          orig.start + step - drag.grabStep,
          0,
          totalSteps - orig.length
        ),
        degree: clamp(
          orig.degree + degree - drag.grabDegree,
          0,
          MELODY_RANGE - 1
        ),
      }
    } else if (drag.mode === "resize") {
      note = {
        ...orig,
        length: clamp(step - orig.start + 1, 1, totalSteps - orig.start),
      }
    } else {
      // Drawing a new note: drag right to set its length.
      note =
        step === drag.grabStep
          ? orig
          : {
              ...orig,
              length: clamp(step - orig.start + 1, 1, totalSteps - orig.start),
            }
    }

    const current = draft?.find((n) => n.id === orig.id)
    if (
      current &&
      current.start === note.start &&
      current.length === note.length &&
      current.degree === note.degree
    )
      return
    if (current && current.degree !== note.degree)
      onPreview(midiOf(note.degree))

    const placed = place(
      melody.filter((n) => n.id !== orig.id),
      note
    )
    if (!placed) return // would overwrite a locked note
    setDraft(placed)
    if (!drag.moved) setDrag({ ...drag, moved: true })
  }

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (!cancelled) {
      if (drag.mode !== "create" && !drag.moved) {
        // A plain click on a note selects it.
        setSelected(drag.orig.id)
        if (stepInput)
          setCursor(Math.min(drag.orig.start + drag.orig.length, totalSteps))
      } else if (draft) {
        onChange(draft)
        setSelected(drag.orig.id)
      }
    }
    setDrag(null)
    setDraft(null)
  }

  const deleteNote = (id: string) => {
    if (melody.find((n) => n.id === id)?.locked)
      return void toast("That note is locked", {
        description: "Unlock it first (select it and press L).",
      })
    onChange(melody.filter((n) => n.id !== id))
    if (selected === id) setSelected(null)
  }

  // Keyboard: Esc cancels a drag / deselects; with a note selected,
  // Delete removes it, arrows move it, Shift+←/→ changes its length.
  const onKey = React.useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (drag) {
        setDrag(null)
        setDraft(null)
      } else setSelected(null)
      return
    }
    if (!selected || drag || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof Element && e.target.closest(KEY_EXEMPT)) return
    const note = melody.find((n) => n.id === selected)
    if (!note) return

    if (e.key === "l" || e.key === "L") {
      e.preventDefault()
      toggleLock(note.id)
      return
    }
    if (note.locked && e.key.startsWith("Arrow")) return

    let next: MelodyNote | null = null
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      deleteNote(note.id)
      return
    } else if (e.key === "ArrowLeft" && e.shiftKey)
      next = { ...note, length: Math.max(1, note.length - 1) }
    else if (e.key === "ArrowRight" && e.shiftKey)
      next = {
        ...note,
        length: Math.min(totalSteps - note.start, note.length + 1),
      }
    else if (e.key === "ArrowLeft")
      next = { ...note, start: Math.max(0, note.start - 1) }
    else if (e.key === "ArrowRight")
      next = {
        ...note,
        start: Math.min(totalSteps - note.length, note.start + 1),
      }
    else if (e.key === "ArrowUp")
      next = { ...note, degree: Math.min(MELODY_RANGE - 1, note.degree + 1) }
    else if (e.key === "ArrowDown")
      next = { ...note, degree: Math.max(0, note.degree - 1) }
    if (!next) return

    e.preventDefault()
    if (
      next.start === note.start &&
      next.length === note.length &&
      next.degree === note.degree
    )
      return
    const placed = place(
      melody.filter((n) => n.id !== note.id),
      next
    )
    if (!placed) return
    onChange(placed)
    if (next.degree !== note.degree) onPreview(midiOf(next.degree))
  })
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e)
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const segments = chords.map((c) => ({
    chord: c,
    len: c.beats * STEPS_PER_BEAT,
  }))

  // Vertical grid lines: bar > beat > eighth.
  const gridBg = {
    backgroundImage: [
      `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${STEPS_PER_BAR * CELL_W}px)`,
      `repeating-linear-gradient(to right, color-mix(in oklab, var(--border) 70%, transparent) 0 1px, transparent 1px ${STEPS_PER_BEAT * CELL_W}px)`,
      `repeating-linear-gradient(to right, color-mix(in oklab, var(--border) 35%, transparent) 0 1px, transparent 1px ${CELL_W}px)`,
    ].join(","),
  }

  return (
    <Card>
      <CardHeader className="max-sm:flex max-sm:flex-col">
        <CardTitle>Melody</CardTitle>
        <CardDescription>
          Click or drag on the grid to draw notes. Drag a note to move it or its
          right edge to resize it. Click a note to select it (arrow keys nudge
          it, Delete removes it, L locks it); double-click or right-click
          deletes. Use a bar number's menu to regenerate a bar or repeat it as a
          motif.
        </CardDescription>
        <CardAction className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={!canLink}
                title={
                  canLink
                    ? "Reuse another section's melody, or lead into the next section"
                    : "Give another section a melody to link them"
                }
              >
                <Link2Icon /> Sections
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {sources.length > 0 && (
                <>
                  <DropdownMenuLabel>
                    Melody from another section
                  </DropdownMenuLabel>
                  {sources.map((src) => (
                    <DropdownMenuSub key={src.id}>
                      <DropdownMenuSubTrigger>
                        {src.label}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        {BORROW_MODES.map((m) => (
                          <DropdownMenuItem
                            key={m.id}
                            onSelect={() => borrow(src, m.id)}
                            className="flex-col items-start gap-0"
                          >
                            <span className="font-medium">{m.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {m.hint}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </>
              )}
              {sources.length > 0 && leadTargets.length > 0 && (
                <DropdownMenuSeparator />
              )}
              {leadTargets.length > 0 && (
                <>
                  <DropdownMenuLabel>
                    Lead into the next section
                  </DropdownMenuLabel>
                  {leadTargets.map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => leadIn(t)}>
                      Lead into {t.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={() => onChange(melody.filter((n) => n.locked))}
            disabled={melody.length === lockedCount}
            title={lockedCount ? "Clear all unlocked notes" : "Clear all notes"}
          >
            <EraserIcon /> Clear
          </Button>
          <Button onClick={generate} disabled={!chords.length}>
            <SparklesIcon /> Generate
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <KeyboardInputBar
          label="Step input"
          hint="Each key adds a note at the cursor, using the new note length. Notes snap to the key."
          active={stepInput}
          onToggle={toggleStepInput}
        >
          <span
            className="font-mono text-xs text-muted-foreground"
            data-step-cursor={cursor}
          >
            Bar {Math.floor(cursor / STEPS_PER_BAR) + 1}, beat{" "}
            {((cursor % STEPS_PER_BAR) / STEPS_PER_BEAT + 1).toFixed(
              cursor % STEPS_PER_BEAT ? 1 : 0
            )}
          </span>
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={() => setCursor(Math.max(0, cursor - stepLength()))}
              disabled={cursor === 0}
            >
              Back
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setCursor(Math.min(totalSteps, cursor + stepLength()))
              }
              disabled={cursor >= totalSteps}
            >
              Rest
            </Button>
            <Button size="xs" variant="outline" onClick={() => setCursor(0)}>
              Restart
            </Button>
          </div>
        </KeyboardInputBar>
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex w-56 flex-col gap-2">
            <Label className="flex justify-between text-xs text-muted-foreground">
              Note density{" "}
              <span className="font-mono text-foreground">{density}%</span>
            </Label>
            <Slider
              value={[density]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => setDensity(v)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">
              New note length
            </Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={newLength}
              onValueChange={(v) => v && setNewLength(v)}
            >
              <ToggleGroupItem value="1">1/8</ToggleGroupItem>
              <ToggleGroupItem value="2">1/4</ToggleGroupItem>
              <ToggleGroupItem value="4">1/2</ToggleGroupItem>
              <ToggleGroupItem value="8">1</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p className="text-xs text-muted-foreground">
            {notes.length} notes
            {lockedCount > 0 && ` · ${lockedCount} locked`} ·{" "}
            {totalSteps / STEPS_PER_BEAT} beats
          </p>
          {selectedNote && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                Selected{" "}
                <b className="font-mono text-foreground">
                  {noteNameWithOctave(midiOf(selectedNote.degree), musicKey)}
                </b>
              </span>
              <Button
                size="xs"
                variant={selectedNote.locked ? "secondary" : "outline"}
                onClick={() => toggleLock(selectedNote.id)}
                aria-pressed={!!selectedNote.locked}
              >
                {selectedNote.locked ? <LockIcon /> : <LockOpenIcon />}
                {selectedNote.locked ? "Locked" : "Lock"}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={selectedNote.locked}
                onClick={() => deleteNote(selectedNote.id)}
              >
                <Trash2Icon /> Delete
              </Button>
            </div>
          )}
        </div>

        {totalSteps === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Add some chords first.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <div className="flex">
              {/* Row labels */}
              <div className="sticky left-0 z-20 shrink-0 border-r bg-card">
                <div style={{ height: CELL_H + 4 }} className="border-b" />
                <div style={{ height: RULER_H }} className="border-b" />
                {rows.map((d) => (
                  <div
                    key={d}
                    style={{ height: CELL_H }}
                    className={cn(
                      "flex w-14 items-center justify-end pr-2 font-mono text-[11px] text-muted-foreground",
                      d % 7 === 0 && "font-semibold text-foreground"
                    )}
                  >
                    {noteNameWithOctave(midiOf(d), musicKey)}
                  </div>
                ))}
              </div>

              <div className="relative" style={{ width: totalSteps * CELL_W }}>
                {/* Chord lane */}
                <div className="flex border-b" style={{ height: CELL_H + 4 }}>
                  {segments.map((seg) => (
                    <div
                      key={seg.chord.id}
                      style={{ width: seg.len * CELL_W }}
                      className="flex shrink-0 items-center truncate border-r px-2 text-xs font-medium"
                    >
                      {chordName(seg.chord, musicKey)}
                    </div>
                  ))}
                </div>
                {/* Bar ruler */}
                <div className="flex border-b" style={{ height: RULER_H }}>
                  {allBars.map((bar) => {
                    const inBar = barNotes(bar)
                    const allLocked =
                      inBar.length > 0 && inBar.every((n) => n.locked)
                    const apply = (next: MelodyNote[], msg: string) => {
                      onChange(next)
                      toast.success(msg)
                    }
                    return (
                      <div
                        key={bar}
                        className="shrink-0 border-l p-0.5"
                        style={{
                          width:
                            Math.min(
                              STEPS_PER_BAR,
                              totalSteps - bar * STEPS_PER_BAR
                            ) * CELL_W,
                        }}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Bar ${bar + 1} options`}
                              className="flex h-full items-center gap-0.5 rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                            >
                              {bar + 1}
                              {allLocked && <LockIcon className="size-2.5" />}
                              <ChevronDownIcon className="size-3 opacity-60" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-64">
                            <DropdownMenuLabel>Bar {bar + 1}</DropdownMenuLabel>
                            <DropdownMenuItem
                              onSelect={() =>
                                onChange(
                                  regenerateBar(melody, chords, bar, genOpts())
                                )
                              }
                            >
                              <RefreshCwIcon /> Regenerate this bar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={!inBar.length || bar === bars - 1}
                              onSelect={() =>
                                apply(
                                  repeatBar(
                                    melody,
                                    chords,
                                    bar,
                                    [bar + 1],
                                    true,
                                    STEPS_PER_BAR
                                  ),
                                  `Copied bar ${bar + 1} to bar ${bar + 2}`
                                )
                              }
                            >
                              <CopyIcon /> Copy to next bar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!inBar.length || bars < 2}
                              onSelect={() =>
                                apply(
                                  repeatBar(
                                    melody,
                                    chords,
                                    bar,
                                    allBars,
                                    true,
                                    STEPS_PER_BAR
                                  ),
                                  `Repeated bar ${bar + 1} across the song, following the chords`
                                )
                              }
                            >
                              <Repeat2Icon /> Repeat in every bar (follow
                              chords)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!inBar.length || bars < 2}
                              onSelect={() =>
                                apply(
                                  repeatBar(
                                    melody,
                                    chords,
                                    bar,
                                    allBars,
                                    false,
                                    STEPS_PER_BAR
                                  ),
                                  `Repeated bar ${bar + 1} across the song`
                                )
                              }
                            >
                              <RepeatIcon /> Repeat in every bar (exact)
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={!inBar.length}
                              onSelect={() =>
                                onChange(
                                  lockBar(
                                    melody,
                                    chords,
                                    bar,
                                    !allLocked,
                                    STEPS_PER_BAR
                                  )
                                )
                              }
                            >
                              {allLocked ? <LockOpenIcon /> : <LockIcon />}
                              {allLocked ? "Unlock" : "Lock"} notes in this bar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={!inBar.some((n) => !n.locked)}
                              onSelect={() =>
                                onChange(
                                  clearBar(melody, chords, bar, STEPS_PER_BAR)
                                )
                              }
                            >
                              <EraserIcon /> Clear this bar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )
                  })}
                </div>

                {/* Note grid */}
                <div
                  ref={gridRef}
                  className={cn(
                    "relative touch-none select-none",
                    drag?.mode === "move" && drag.moved
                      ? "cursor-grabbing"
                      : "cursor-crosshair",
                    drag?.mode === "resize" && "cursor-ew-resize"
                  )}
                  style={{ height: MELODY_RANGE * CELL_H, ...gridBg }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={(e) => finish(e)}
                  onPointerCancel={(e) => finish(e, true)}
                  onDoubleClick={(e) => {
                    const id = (e.target as HTMLElement).closest<HTMLElement>(
                      "[data-note-id]"
                    )?.dataset.noteId
                    if (id) deleteNote(id)
                  }}
                  onContextMenu={(e) => {
                    const id = (e.target as HTMLElement).closest<HTMLElement>(
                      "[data-note-id]"
                    )?.dataset.noteId
                    if (!id) return
                    e.preventDefault()
                    deleteNote(id)
                  }}
                >
                  {rows.map((d, i) => (
                    <div
                      key={d}
                      className={cn(
                        "pointer-events-none absolute inset-x-0 border-b border-border/40",
                        d % 7 === 0 && "bg-muted/60"
                      )}
                      style={{ top: i * CELL_H, height: CELL_H }}
                    />
                  ))}

                  {notes.map((n) => {
                    const active = drag?.orig.id === n.id || n.id === selected
                    return (
                      <div
                        key={n.id}
                        data-note-id={n.id}
                        title={`${noteNameWithOctave(midiOf(n.degree), musicKey)}${n.locked ? " (locked)" : ""}`}
                        data-locked={n.locked || undefined}
                        className={cn(
                          "group absolute flex cursor-grab items-center justify-end rounded-sm bg-primary shadow-sm ring-1 ring-primary-foreground/30 hover:brightness-110",
                          n.locked &&
                            "cursor-pointer bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklab,var(--primary-foreground)_18%,transparent)_4px_6px)] ring-primary-foreground/60",
                          active && "z-10 ring-2 ring-foreground"
                        )}
                        style={{
                          left: n.start * CELL_W + 1,
                          top: (MELODY_RANGE - 1 - n.degree) * CELL_H + 2,
                          width: n.length * CELL_W - 2,
                          height: CELL_H - 4,
                        }}
                      >
                        {n.locked ? (
                          n.length * CELL_W > 18 && (
                            <LockIcon className="pointer-events-none mr-1 size-2.5 text-primary-foreground" />
                          )
                        ) : (
                          <div
                            data-resize
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-sm group-hover:bg-primary-foreground/30"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>

                {stepInput && cursor < totalSteps && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-primary"
                    style={{ left: cursor * CELL_W }}
                  >
                    <div className="absolute top-0 -left-1 size-2.5 rotate-45 bg-primary" />
                  </div>
                )}
                {playheadBeat !== null && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-destructive"
                    style={{ left: playheadBeat * STEPS_PER_BEAT * CELL_W }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
