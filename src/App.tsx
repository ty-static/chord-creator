import * as React from "react"
import {
  DownloadIcon,
  CircleHelpIcon,
  FilePlusIcon,
  KeyboardIcon,
  LibraryIcon,
  Loader2Icon,
  MoonIcon,
  MusicIcon,
  PlayIcon,
  Redo2Icon,
  RepeatIcon,
  SquareIcon,
  SunIcon,
  Undo2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ChordEditor } from "@/components/chord-editor"
import { DrumEditor } from "@/components/drum-editor"
import { ImportDialog, type PendingImport } from "@/components/import-dialog"
import { KeyboardInputBar, MidiKeyboardMenu } from "@/components/midi-keyboard"
import { MelodyEditor } from "@/components/melody-editor"
import { SoundPanel } from "@/components/sound-panel"
import { WelcomeTour } from "@/components/welcome-tour"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type LoopRange, Timeline } from "@/components/timeline"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
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
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toaster } from "@/components/ui/sonner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  type ChordStyle,
  type Song,
  type TrackName,
  buildEvents,
} from "@/lib/arrange"
import {
  DEFAULT_MIX,
  type Release,
  type TrackMix,
  engine,
} from "@/lib/audio-engine"
import { chordFromPitches } from "@/lib/harmony"
import { MidiParseError, parseMidi } from "@/lib/midi-import"
import { type MidiNoteEvent, midiInput } from "@/lib/midi-input"
import { DEFAULT_INSTRUMENTS, INSTRUMENTS } from "@/lib/instruments"
import { buildMidi, downloadBytes } from "@/lib/midi"
import {
  PRESETS,
  ROOTS,
  SCALES,
  type ScaleId,
  STEPS_PER_BEAT,
  type Chord,
  chordName,
  uid,
  voiceChords,
  chordsFromPreset,
  generateMelody,
  keyLabel,
  keySignature,
  noteName,
  scaleNotes,
  totalBeats,
} from "@/lib/music"
import {
  type SetOptions,
  useHistory,
  useUndoShortcuts,
} from "@/lib/use-history"
import { type PlaySettings, usePlayer } from "@/lib/use-player"
import { DEFAULT_DRUMS, presetPattern } from "@/lib/drums"
import { EXAMPLES, type Example, blankSong } from "@/lib/examples"

const STORAGE_KEY = "chord-creator:song"
const TOUR_KEY = "chord-creator:tour-seen"

const SOUND_DEFAULTS = {
  instruments: DEFAULT_INSTRUMENTS,
  reverb: 0.25,
  mix: DEFAULT_MIX,
  voiceLeading: false,
  drums: DEFAULT_DRUMS,
}

function initialSong(): Song {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      // Fill in fields added in later versions of the app.
      const s = JSON.parse(saved) as Partial<Song>
      return {
        ...SOUND_DEFAULTS,
        ...s,
        instruments: { ...DEFAULT_INSTRUMENTS, ...s.instruments },
        mix: {
          chords: { ...DEFAULT_MIX.chords, ...s.mix?.chords },
          melody: { ...DEFAULT_MIX.melody, ...s.mix?.melody },
          bass: { ...DEFAULT_MIX.bass, ...s.mix?.bass },
          drums: { ...DEFAULT_MIX.drums, ...s.mix?.drums },
        },
        drums: { ...DEFAULT_DRUMS, ...s.drums },
      } as Song
    }
  } catch {
    /* ignore corrupt storage */
  }
  const chords = chordsFromPreset(PRESETS[0])
  return {
    key: { root: 0, scale: "major" },
    bpm: 100,
    chords,
    melody: generateMelody(chords, { density: 0.55, seed: 7 }),
    chordStyle: "block",
    bass: true,
    ...SOUND_DEFAULTS,
    drums: { ...DEFAULT_DRUMS, enabled: true, pattern: presetPattern("pop") },
  }
}

const SPACE_EXEMPT =
  "input, textarea, select, [contenteditable=true], [role=slider], [role=switch], [role=combobox], [role=option], [role=tab], [role=radio], [role=checkbox], [role=menuitem], [aria-roledescription=sortable]"

type ExportScope = "all" | "chords" | "melody" | "drums"

const SCOPE_LAYERS: Record<ExportScope, Record<TrackName, boolean>> = {
  all: { chords: true, melody: true, bass: true, drums: true },
  chords: { chords: true, melody: false, bass: true, drums: false },
  melody: { chords: false, melody: true, bass: false, drums: false },
  drums: { chords: false, melody: false, bass: false, drums: true },
}

export function App() {
  const history = useHistory<Song>(initialSong)
  const song = history.value
  useUndoShortcuts(history.undo, history.redo)
  const [loop, setLoop] = React.useState(true)
  const [scope, setScope] = React.useState<ExportScope>("all")
  const player = usePlayer()
  const { theme, setTheme } = useTheme()

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(song))
  }, [song])

  const patch = (p: Partial<Song>, opts?: SetOptions) =>
    history.set((s) => ({ ...s, ...p }), opts)
  const beats = totalBeats(song.chords)

  // Welcome tour: shown automatically on the first visit.
  const [tourOpen, setTourOpen] = React.useState(
    () => !localStorage.getItem(TOUR_KEY)
  )
  const setTour = (open: boolean) => {
    setTourOpen(open)
    if (!open) localStorage.setItem(TOUR_KEY, "1")
  }

  const loadSong = (next: Song, label: string) => {
    history.set(next)
    toast.success(`Loaded ${label}`, {
      action: { label: "Undo", onClick: () => history.undo() },
    })
  }
  const loadExample = (ex: Example) => loadSong(ex.build(), `“${ex.label}”`)
  const voicings = React.useMemo(
    () => voiceChords(song.chords, song.key, song.voiceLeading),
    [song.chords, song.key, song.voiceLeading]
  )

  const { preload } = player

  React.useEffect(() => engine.setReverb(song.reverb), [song.reverb])
  React.useEffect(() => engine.setMix(song.mix), [song.mix])

  // Browsers only allow audio after a user gesture, so start downloading the
  // selected instruments on the first interaction (and whenever they change).
  const [audioArmed, setAudioArmed] = React.useState(false)
  React.useEffect(() => {
    if (audioArmed) return
    const arm = () => setAudioArmed(true)
    window.addEventListener("pointerdown", arm, { once: true })
    window.addEventListener("keydown", arm, { once: true })
    return () => {
      window.removeEventListener("pointerdown", arm)
      window.removeEventListener("keydown", arm)
    }
  }, [audioArmed])
  React.useEffect(() => {
    if (audioArmed) preload(song.instruments)
  }, [audioArmed, song.instruments, preload])

  // ---- MIDI file import (button or drag-and-drop)
  const [pendingImport, setPendingImport] =
    React.useState<PendingImport | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const openMidiFile = async (file: File) => {
    try {
      const midi = parseMidi(await file.arrayBuffer())
      setPendingImport({ filename: file.name, midi })
    } catch (err) {
      toast.error(`Couldn't read ${file.name}`, {
        description:
          err instanceof MidiParseError
            ? err.message
            : "The file doesn't look like a valid MIDI file.",
      })
    }
  }
  React.useEffect(() => {
    const isFileDrag = (e: DragEvent) =>
      e.dataTransfer?.types.includes("Files") ?? false
    const over = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0]
      if (!file) return
      e.preventDefault()
      if (/\.midi?$/i.test(file.name)) void openMidiFile(file)
      else toast.error("Drop a .mid or .midi file to import it.")
    }
    window.addEventListener("dragover", over)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragover", over)
      window.removeEventListener("drop", drop)
    }
  }, [])

  // ---- MIDI keyboard: play-through and chord input
  const [tab, setTab] = React.useState("chords")
  const [playThrough, setPlayThrough] = React.useState(true)
  const [chordInput, setChordInput] = React.useState(false)
  const downRef = React.useRef(new Set<number>())
  const releasesRef = React.useRef(new Map<number, Release | void>())
  const chordNotesRef = React.useRef<number[]>([])

  const addChordFromKeys = (pitches: number[]) => {
    const guess = chordFromPitches(pitches, song.key)
    if (!guess) return
    const chord: Chord = {
      id: uid(),
      degree: guess.degree,
      type: guess.type,
      inversion: guess.inversion,
      beats: 4,
    }
    patch({ chords: [...song.chords, chord] })
    toast.success(`Added ${chordName(chord, song.key)}`)
  }

  const onKeyboardNote = React.useEffectEvent(async (e: MidiNoteEvent) => {
    const down = downRef.current
    const track: TrackName =
      tab === "melody" ? "melody" : tab === "drums" ? "drums" : "chords"
    if (e.type === "on") {
      down.add(e.note)
      if (tab === "chords" && chordInput) chordNotesRef.current.push(e.note)
      if (!playThrough) return
      const ctx = await engine.resume()
      const voice = await engine.voice(song.instruments[track], track)
      releasesRef.current.get(e.note)?.()
      const release = voice.start({
        note: e.note,
        time: ctx.currentTime,
        duration: track === "drums" ? 0.3 : 8,
        velocity: e.velocity,
      })
      // The key may have been let go while the instrument was loading.
      if (down.has(e.note)) releasesRef.current.set(e.note, release)
      else release?.()
      return
    }
    down.delete(e.note)
    releasesRef.current.get(e.note)?.()
    releasesRef.current.delete(e.note)
    if (down.size === 0 && chordNotesRef.current.length) {
      const pitches = chordNotesRef.current
      chordNotesRef.current = []
      if (tab === "chords" && chordInput) addChordFromKeys(pitches)
    }
  })
  React.useEffect(() => midiInput.onNote((e) => void onKeyboardNote(e)), [])

  const setInstrument = (track: TrackName, id: string) =>
    patch({ instruments: { ...song.instruments, [track]: id } })
  const setMix = (track: TrackName, p: Partial<TrackMix>, coalesce?: string) =>
    history.set(
      (s) => ({ ...s, mix: { ...s.mix, [track]: { ...s.mix[track], ...p } } }),
      { coalesce }
    )

  // Loop section chosen on the timeline (ignored if the song got shorter than it).
  const [loopRangeRaw, setLoopRange] = React.useState<LoopRange | null>(null)
  const loopRange =
    loopRangeRaw && loopRangeRaw.start < beats
      ? { ...loopRangeRaw, end: Math.min(loopRangeRaw.end, beats) }
      : null

  // The notes to play, rebuilt whenever the music changes.
  const events = React.useMemo(
    () => buildEvents(song, SCOPE_LAYERS.all),
    // Only the fields that change the notes (not mix or reverb).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      song.key,
      song.chords,
      song.melody,
      song.chordStyle,
      song.bass,
      song.voiceLeading,
      song.drums,
    ]
  )
  const playSettings = (
    opts: { loop?: boolean; range?: LoopRange | null } = {}
  ): PlaySettings => {
    const range = opts.range === undefined ? loopRange : opts.range
    return {
      events,
      bpm: song.bpm,
      end: beats,
      loop: opts.loop ?? loop,
      loopStart: range?.start,
      loopEnd: range?.end,
      instruments: song.instruments,
    }
  }

  // Keep playing while editing: hand every change to the running player.
  const { update } = player
  const liveSettings = playSettings()
  const liveKey = JSON.stringify({ ...liveSettings, events: undefined })
  React.useEffect(
    () => void update(liveSettings),
    // liveSettings is rebuilt each render; it only matters when these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update, events, liveKey]
  )

  const activeChordId = React.useMemo(() => {
    if (player.beat === null) return null
    let t = 0
    for (const c of song.chords) {
      if (player.beat < t + c.beats) return c.id
      t += c.beats
    }
    return null
  }, [player.beat, song.chords])

  const playFrom = (
    from: number,
    opts: { loop?: boolean; range?: LoopRange | null } = {}
  ) => {
    if (!beats) return toast.error("Add at least one chord first.")
    void player.play(playSettings(opts), from)
  }

  const togglePlay = () => {
    if (player.playing || player.loading) return player.stop()
    playFrom(loop && loopRange ? loopRange.start : 0)
  }

  const changeLoopRange = (range: LoopRange | null) => {
    setLoopRange(range)
    if (range) {
      setLoop(true)
      playFrom(range.start, { loop: true, range })
    } // Clearing the range: the running player just carries on over the whole song.
  }

  // Space bar = play / stop (unless typing or using a control that needs it).
  const onSpace = React.useEffectEvent(() => togglePlay())
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey)
        return
      if (e.target instanceof Element && e.target.closest(SPACE_EXEMPT)) return
      e.preventDefault()
      onSpace()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const exportMidi = () => {
    const events = buildEvents(song, SCOPE_LAYERS[scope])
    if (!events.length) return toast.error("Nothing to export yet.")
    const name = keyLabel(song.key)
      .replace(/♯/g, "sharp")
      .replace(/♭/g, "b")
      .replace(/\s+/g, "-")
    const filename = `chord-creator_${name}_${song.bpm}bpm${scope === "all" ? "" : `_${scope}`}.mid`
    downloadBytes(
      buildMidi(events, {
        bpm: song.bpm,
        title: `Chord Creator – ${keyLabel(song.key)}`,
        keySig: keySignature(song.key),
        programs: {
          chords: INSTRUMENTS[song.instruments.chords]?.program,
          melody: INSTRUMENTS[song.instruments.melody]?.program,
          bass: INSTRUMENTS[song.instruments.bass]?.program,
        },
        volumes: {
          chords: song.mix.chords.volume,
          melody: song.mix.melody.volume,
          bass: song.mix.bass.volume,
          drums: song.mix.drums.volume,
        },
      }),
      filename
    )
    toast.success(`Exported ${filename}`)
  }

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:flex">
            <MusicIcon className="size-5" />
          </div>
          <div className="mr-auto min-w-0">
            <h1 className="truncate font-heading text-base leading-tight font-semibold sm:text-lg">
              Chord Creator
            </h1>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Write chords & melodies, export to MIDI
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".mid,.midi,audio/midi,audio/x-midi"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void openMidiFile(file)
            }}
          />
          <Button
            variant="ghost"
            className="max-sm:size-9 max-sm:px-0"
            aria-label="Import MIDI file"
            title="Import a MIDI file (or drop one anywhere)"
            onClick={() => fileRef.current?.click()}
          >
            <UploadIcon />
            <span className="hidden sm:inline">Import</span>
          </Button>
          <MidiKeyboardMenu
            playThrough={playThrough}
            onPlayThrough={setPlayThrough}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="max-sm:size-9 max-sm:px-0"
                aria-label="Example songs"
              >
                <LibraryIcon />
                <span className="hidden sm:inline">Examples</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Example songs</DropdownMenuLabel>
              {EXAMPLES.map((ex) => (
                <DropdownMenuItem
                  key={ex.id}
                  onSelect={() => loadExample(ex)}
                  className="flex-col items-start gap-0"
                >
                  <span className="font-medium">{ex.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {ex.description}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => loadSong(blankSong(song), "a blank song")}
              >
                <FilePlusIcon /> New blank song
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTour(true)}>
                <CircleHelpIcon /> Take the tour
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Take the tour"
            title="Take the tour"
            className="hidden sm:inline-flex"
            onClick={() => setTour(true)}
          >
            <CircleHelpIcon />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Keyboard shortcuts"
                className="hidden sm:inline-flex"
              >
                <KeyboardIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-none">
              <ShortcutList />
            </TooltipContent>
          </Tooltip>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              disabled={!history.canUndo}
              onClick={history.undo}
            >
              <Undo2Icon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Redo"
              className="hidden sm:inline-flex"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!history.canRedo}
              onClick={history.redo}
            >
              <Redo2Icon />
            </Button>
          </div>
          <Button
            variant={loop ? "secondary" : "ghost"}
            size="icon"
            aria-label="Toggle loop"
            aria-pressed={loop}
            onClick={() => setLoop((l) => !l)}
          >
            <RepeatIcon />
          </Button>
          <Button
            onClick={togglePlay}
            variant={player.playing ? "destructive" : "default"}
            className="sm:w-28"
            title={
              player.loading
                ? "Loading instruments… click to cancel"
                : undefined
            }
          >
            {player.loading ? (
              <Loader2Icon className="animate-spin" />
            ) : player.playing ? (
              <SquareIcon />
            ) : (
              <PlayIcon />
            )}
            <span className="max-sm:sr-only">
              {player.loading ? "Loading" : player.playing ? "Stop" : "Play"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            className="hidden sm:inline-flex"
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6 lg:grid-cols-[300px_1fr]">
        <aside className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-4 lg:self-start">
          <Card className="order-1 lg:order-none">
            <CardHeader>
              <CardTitle>Key & Tempo</CardTitle>
              <CardDescription>
                Everything follows the key you choose.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="root">Key</Label>
                  <Select
                    value={String(song.key.root)}
                    onValueChange={(v) =>
                      patch({ key: { ...song.key, root: Number(v) } })
                    }
                  >
                    <SelectTrigger id="root" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROOTS.map((r) => (
                        <SelectItem key={r.value} value={String(r.value)}>
                          {noteName(r.value, {
                            root: r.value,
                            scale: song.key.scale,
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="scale">Scale</Label>
                  <Select
                    value={song.key.scale}
                    onValueChange={(v) =>
                      patch({ key: { ...song.key, scale: v as ScaleId } })
                    }
                  >
                    <SelectTrigger id="scale" className="w-full">
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
              <div className="flex flex-wrap gap-1">
                {scaleNotes(song.key).map((n, i) => (
                  <Badge
                    key={i}
                    variant={i === 0 ? "default" : "secondary"}
                    className="font-mono"
                  >
                    {n}
                  </Badge>
                ))}
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <Label className="flex justify-between">
                  Tempo{" "}
                  <span className="font-mono text-muted-foreground">
                    {song.bpm} BPM
                  </span>
                </Label>
                <Slider
                  value={[song.bpm]}
                  min={50}
                  max={200}
                  step={1}
                  onValueChange={([v]) =>
                    patch({ bpm: v }, { coalesce: "bpm" })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Chord rhythm</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  className="w-full"
                  value={song.chordStyle}
                  onValueChange={(v) =>
                    v && patch({ chordStyle: v as ChordStyle })
                  }
                >
                  <ToggleGroupItem value="block" className="flex-1">
                    Block
                  </ToggleGroupItem>
                  <ToggleGroupItem value="pulse" className="flex-1">
                    Pulse
                  </ToggleGroupItem>
                  <ToggleGroupItem value="arpeggio" className="flex-1">
                    Arp
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="voice-leading"
                  className="flex flex-col items-start gap-0.5"
                >
                  Smooth voice leading
                  <span className="text-xs font-normal text-muted-foreground">
                    Auto-pick inversions so chords move less
                  </span>
                </Label>
                <Switch
                  id="voice-leading"
                  checked={song.voiceLeading}
                  onCheckedChange={(voiceLeading) => patch({ voiceLeading })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="bass">Bass line (chord roots)</Label>
                <Switch
                  id="bass"
                  checked={song.bass}
                  onCheckedChange={(bass) => patch({ bass })}
                />
              </div>
            </CardContent>
          </Card>

          <div className="order-3 lg:order-none">
            <SoundPanel
              instruments={song.instruments}
              mix={song.mix}
              reverb={song.reverb}
              bassEnabled={song.bass}
              drumsEnabled={song.drums.enabled}
              status={player.status}
              onInstrument={setInstrument}
              onMix={setMix}
              onReverb={(reverb) => patch({ reverb }, { coalesce: "reverb" })}
            />
          </div>

          <Card className="order-4 lg:order-none">
            <CardHeader>
              <CardTitle>Export</CardTitle>
              <CardDescription>
                {song.chords.length} chords · {beats / 4} bars ·{" "}
                {song.melody.length} melody notes
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as ExportScope)}
              >
                <SelectTrigger className="w-full" aria-label="What to export">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    Everything{" "}
                    {[
                      "chords",
                      "melody",
                      song.bass && "bass",
                      song.drums.enabled && "drums",
                    ]
                      .filter(Boolean)
                      .join(" + ")
                      .replace(/^./, (c) => `(${c}`)}
                    )
                  </SelectItem>
                  <SelectItem value="chords">
                    Chords only{song.bass ? " (+ bass)" : ""}
                  </SelectItem>
                  <SelectItem value="melody">Melody only</SelectItem>
                  <SelectItem value="drums" disabled={!song.drums.enabled}>
                    Drums only
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button size="lg" onClick={exportMidi}>
                <DownloadIcon /> Download MIDI
              </Button>
              <p className="text-xs text-muted-foreground">
                Standard MIDI file with separate tracks, tempo and key signature
                — drag it into any DAW.
              </p>
            </CardContent>
          </Card>
        </aside>

        <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-none">
          <Timeline
            voicings={voicings}
            musicKey={song.key}
            chords={song.chords}
            playheadBeat={player.beat}
            loopRange={loopRange}
            activeChordId={activeChordId}
            onSeek={(beat) => playFrom(beat)}
            onLoopChange={changeLoopRange}
          />
          <Tabs value={tab} onValueChange={setTab} className="min-w-0">
            <TabsList>
              <TabsTrigger value="chords">Chords</TabsTrigger>
              <TabsTrigger value="melody">Melody</TabsTrigger>
              <TabsTrigger value="drums">Drums</TabsTrigger>
            </TabsList>
            <TabsContent value="chords" className="mt-2">
              <KeyboardInputBar
                label="Chord input"
                hint="Play a chord and let go to add it. One key adds the chord built on that note."
                active={chordInput}
                onToggle={setChordInput}
              />
              <ChordEditor
                voicings={voicings}
                voiceLeading={song.voiceLeading}
                musicKey={song.key}
                chords={song.chords}
                onChange={(chords) => {
                  // Trim melody notes that now fall past the end of the progression.
                  const end = totalBeats(chords) * STEPS_PER_BEAT
                  const melody = song.melody
                    .filter((n) => n.start < end)
                    .map((n) => ({
                      ...n,
                      length: Math.min(n.length, end - n.start),
                    }))
                  patch({ chords, melody })
                }}
                activeChordId={activeChordId}
                onPreview={(m) =>
                  void player.preview(m, "chords", song.instruments.chords)
                }
              />
            </TabsContent>
            <TabsContent value="melody" className="mt-2">
              <MelodyEditor
                musicKey={song.key}
                chords={song.chords}
                melody={song.melody}
                onChange={(melody) => patch({ melody })}
                playheadBeat={player.beat}
                onPreview={(m) =>
                  void player.preview([m], "melody", song.instruments.melody)
                }
              />
            </TabsContent>
            <TabsContent value="drums" className="mt-2">
              <DrumEditor
                drums={song.drums}
                onChange={(drums) => patch({ drums })}
                playheadBeat={player.playing ? player.beat : null}
                onPreview={(m) =>
                  void player.preview([m], "drums", song.instruments.drums)
                }
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <WelcomeTour
        open={tourOpen}
        onOpenChange={setTour}
        onTryExample={() => loadExample(EXAMPLES[0])}
      />
      <ImportDialog
        pending={pendingImport}
        song={song}
        onCancel={() => setPendingImport(null)}
        onImport={(next, label) => {
          setPendingImport(null)
          loadSong(next, label)
        }}
      />
      <Toaster position="bottom-right" />
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / stop"],
  ["Ctrl + Z", "Undo"],
  ["Ctrl + Shift + Z", "Redo"],
  ["Click a melody note", "Select it"],
  ["Delete / Backspace", "Delete selected note"],
  ["L", "Lock / unlock selected note"],
  ["← →", "Move selected note in time"],
  ["↑ ↓", "Move selected note up / down the scale"],
  ["Shift + ← →", "Shorten / lengthen selected note"],
  ["Esc", "Deselect · cancel drag"],
]

function ShortcutList() {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-1 text-xs">
      {SHORTCUTS.map(([keys, action]) => (
        <React.Fragment key={keys}>
          <kbd className="font-mono font-semibold">{keys}</kbd>
          <span>{action}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

export default App
