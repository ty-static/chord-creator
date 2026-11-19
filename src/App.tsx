import * as React from "react"
import {
  AudioLinesIcon,
  AudioWaveformIcon,
  DownloadIcon,
  FolderOpenIcon,
  LinkIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  EllipsisVerticalIcon,
  FileMusicIcon,
  FilePlusIcon,
  KeyboardIcon,
  LayersIcon,
  LibraryIcon,
  Loader2Icon,
  Music2Icon,
  MonitorDownIcon,
  MoonIcon,
  PlayIcon,
  Redo2Icon,
  RepeatIcon,
  SquareIcon,
  SunIcon,
  Undo2Icon,
  UploadIcon,
  WifiOffIcon,
} from "lucide-react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { toast } from "sonner"

import { ChordEditor } from "@/components/chord-editor"
import { DrumEditor } from "@/components/drum-editor"
import type { PendingImport } from "@/components/import-dialog"
import { Logo } from "@/components/logo"
import { KeyboardInputBar, MidiKeyboardMenu } from "@/components/midi-keyboard"
import {
  type LeadTarget,
  type MelodySource,
  MelodyEditor,
} from "@/components/melody-editor"
import { SoundPanel } from "@/components/sound-panel"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { sectionColor } from "@/components/section-style"
import { SongForm } from "@/components/song-form"
import {
  SectionSettings,
  sectionStyleSummary,
} from "@/components/section-settings"
import { TempoControl } from "@/components/tempo-control"
import { SongTitle } from "@/components/song-title"
import {
  type LoopRange,
  Timeline,
  type TimelinePart,
} from "@/components/timeline"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  type ChordStyle,
  type Song,
  type TrackName,
  type Section,
  buildEvents,
  endingBeats,
  barLines,
  clickBeats,
  keyChanges,
  layout,
  meterChanges,
  placedAt,
  sectionMeter,
  songBars,
} from "@/lib/arrange"
import { type Release, type TrackMix, engine } from "@/lib/audio-engine"
import { chordFromPitches, foldDegree, nearestDegree } from "@/lib/harmony"
import { type MidiNoteEvent, midiInput } from "@/lib/midi-input"
import { INSTRUMENTS } from "@/lib/instruments"
import { buildMidi, downloadBytes } from "@/lib/midi"
import { hasTempoChanges, tempoMap } from "@/lib/tempo"
import { registerServiceWorker, useInstall, useOnline } from "@/lib/pwa"
import {
  ROOTS,
  SCALES,
  type ScaleId,
  STEPS_PER_BEAT,
  type Chord,
  chordName,
  uid,
  voiceChords,
  keyLabel,
  sectionKey,
  degreeToMidi,
  melodyBase,
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
import { cn } from "@/lib/utils"
import { EXAMPLES, type Example, blankSong } from "@/lib/examples"
import { Library, type LibraryEntry } from "@/lib/library"
import { BASS_STYLES, type BassStyle, bassHint, bassLabel } from "@/lib/bass"
import { CHORD_STYLES, chordStyleHint, chordStyleLabel } from "@/lib/rhythm"
import { prefetchLazyModules } from "@/lib/prefetch"
import { isAudioFile } from "@/lib/audio-files"
import {
  SongFileError,
  decodeShare,
  defaultSong,
  fileSlug,
  parseSongFile,
  sameSong,
  shareCode,
  shareUrl,
  songFile,
} from "@/lib/song-file"
import {
  formString,
  sectionLetter,
  setMeter,
  setSectionMeter,
  updateSection,
} from "@/lib/sections"
import {
  METERS,
  type MeterId,
  barBeats,
  barSteps,
  meterOf,
  midiTimeSig,
  pulses,
} from "@/lib/meter"

// Loaded the first time they're needed, to keep the first download small.
const ImportDialog = React.lazy(() =>
  import("@/components/import-dialog").then((m) => ({
    default: m.ImportDialog,
  }))
)
const AudioToMidi = React.lazy(() =>
  import("@/components/audio-to-midi").then((m) => ({
    default: m.AudioToMidi,
  }))
)
const WelcomeTour = React.lazy(() =>
  import("@/components/welcome-tour").then((m) => ({ default: m.WelcomeTour }))
)
const SongLibrary = React.lazy(() =>
  import("@/components/song-library").then((m) => ({ default: m.SongLibrary }))
)
const ChordChartDialog = React.lazy(() =>
  import("@/components/chord-chart").then((m) => ({
    default: m.ChordChartDialog,
  }))
)
const ShareLinkDialog = React.lazy(() =>
  import("@/components/song-library").then((m) => ({
    default: m.ShareLinkDialog,
  }))
)

/** Mounts lazily loaded children once `when` first turns true, then keeps
 *  them mounted so dialogs can animate closed. */
function MountWhen({
  when,
  children,
}: {
  when: boolean
  children: React.ReactNode
}) {
  const [seen, setSeen] = React.useState(when)
  if (when && !seen) setSeen(true)
  return seen ? (
    <React.Suspense fallback={null}>{children}</React.Suspense>
  ) : null
}

const TOUR_KEY = "chord-creator:tour-seen"
/** Whether Play counts in a bar first (a preference, not part of the song). */
const COUNT_IN_KEY = "chord-creator:count-in"
/** Whether the metronome clicks while playing (a preference too). */
const METRONOME_KEY = "chord-creator:metronome"

/** A switch remembered in local storage. */
function useStoredSwitch(key: string) {
  const [on, setOn] = React.useState(() => {
    try {
      return localStorage.getItem(key) === "1"
    } catch {
      return false
    }
  })
  const set = (next: boolean) => {
    setOn(next)
    try {
      if (next) localStorage.setItem(key, "1")
      else localStorage.removeItem(key)
    } catch {
      // Storage blocked: the setting lasts until the page closes.
    }
  }
  return [on, set] as const
}

// The song library, and the song to open first. Opened once per page load
// (outside React, so StrictMode's double render can't add a song twice).
const library = new Library(localStorage)
let boot: { id: string; song: Song } | null = null
/** The time now (outside render: only called from event handlers). */
const clock = () => Date.now()
const bootSong = () => (boot ??= library.open(defaultSong))

/** "my_song-v2.mid" → "my song v2" */
const titleFromFile = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 60) || "Imported song"

const SPACE_EXEMPT =
  "input, textarea, select, [contenteditable=true], [role=slider], [role=switch], [role=combobox], [role=option], [role=tab], [role=radio], [role=checkbox], [role=menuitem], [aria-roledescription=sortable], [role=grid] button"

type ExportScope = "all" | "chords" | "melody" | "drums"

const TRACK_TITLES: Record<TrackName, string> = {
  chords: "Chords",
  melody: "Melody",
  bass: "Bass",
  drums: "Drums",
}

const SCOPE_LAYERS: Record<ExportScope, Record<TrackName, boolean>> = {
  all: { chords: true, melody: true, bass: true, drums: true },
  chords: { chords: true, melody: false, bass: true, drums: false },
  melody: { chords: false, melody: true, bass: false, drums: false },
  drums: { chords: false, melody: false, bass: false, drums: true },
}

export function App() {
  const history = useHistory<Song>(() => bootSong().song)
  const song = history.value
  const [songId, setSongId] = React.useState(() => bootSong().id)
  useUndoShortcuts(history.undo, history.redo)
  const [loop, setLoop] = React.useState(true)
  const [countIn, setCountIn] = useStoredSwitch(COUNT_IN_KEY)
  const [metronome, setMetronome] = useStoredSwitch(METRONOME_KEY)
  const [scope, setScope] = React.useState<ExportScope>("all")
  const [rendering, setRendering] = React.useState<{
    kind: "wav" | "stems"
    /** For stems: which track, e.g. "Bass 3/4". */
    label?: string
    stage: "loading" | "rendering"
    fraction: number
  } | null>(null)
  const player = usePlayer()
  const { theme, setTheme } = useTheme()

  // Offline use and installing as an app.
  const { how: installHow, install } = useInstall()
  React.useEffect(
    () =>
      registerServiceWorker((apply) =>
        toast("A new version of Static Sound is ready", {
          description: "Reload to use it. Your song is saved.",
          duration: Infinity,
          action: { label: "Reload", onClick: apply },
        })
      ),
    []
  )
  const online = useOnline()
  const wasOnline = React.useRef(online)
  React.useEffect(() => {
    if (wasOnline.current === online) return
    wasOnline.current = online
    if (online) toast.success("Back online")
    else
      toast("You're offline", {
        icon: <WifiOffIcon className="size-4" />,
        description:
          "Static Sound keeps working. Instruments you haven't played yet use the built-in synth until you're back online.",
      })
  }, [online])
  const installApp = async () => {
    if (installHow === "ios")
      return toast("Install on iPhone or iPad", {
        description: "In Safari, tap Share, then Add to Home Screen.",
      })
    if (await install())
      toast.success("Static Sound is installed", {
        description: "Open it from your apps. It works offline too.",
      })
  }

  // Save every change to the library. The song as it was opened isn't
  // re-saved, so opening a song doesn't count as editing it.
  const openedRef = React.useRef<Song>(song)
  const saveWarned = React.useRef(false)
  React.useEffect(() => {
    if (song === openedRef.current) return
    if (library.save(songId, song)) saveWarned.current = false
    else if (!saveWarned.current) {
      saveWarned.current = true
      toast.error("Couldn't save your song", {
        description:
          "The browser's storage is full or blocked. Download a song file to keep a copy.",
      })
    }
  }, [song, songId])

  const patch = (p: Partial<Song>, opts?: SetOptions) =>
    history.set((s) => ({ ...s, ...p }), opts)

  // Sections: the form laid out in time, and the section open in the editors.
  const placed = React.useMemo(() => layout(song), [song])
  const beats = placed.reduce((n, p) => n + p.beats, 0)
  const tempo = React.useMemo(() => tempoMap(song), [song])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const section =
    song.sections.find((s) => s.id === selectedId) ?? song.sections[0]
  const sectionIndex = song.sections.indexOf(section)
  const patchSection = (p: Partial<Omit<Section, "id">>, opts?: SetOptions) =>
    history.set((s) => updateSection(s, section.id, p), opts)
  /** Section style changes. A time signature also refits the section's
   *  chords, melody and drums, so it goes through setSectionMeter. */
  const patchSectionStyle = (
    p: Partial<Omit<Section, "id">>,
    opts?: SetOptions
  ) => {
    if (!("meter" in p)) return patchSection(p, opts)
    const { meter, ...rest } = p
    history.set(
      (s) =>
        updateSection(setSectionMeter(s, section.id, meter), section.id, rest),
      opts
    )
    // A loop over bars no longer lines up with them.
    if (meter !== section.meter && loopTarget && "start" in loopTarget)
      setLoopTarget(null)
  }
  const anyDrums = song.sections.some((s) => s.drums.enabled)
  /** The key the selected section plays in (after any key change): the
   *  editors show and build notes in it. */
  const editKey = sectionKey(song.key, section.transpose)
  const meter = meterOf(song.meter)
  /** The selected section's time signature (its own, or the song's): the
   *  editors count bars in it. */
  const editMeter = sectionMeter(song, section)
  const bar = barBeats(editMeter)

  // Fetch the code for dialogs, exports and sound once the page is idle.
  React.useEffect(() => prefetchLazyModules(), [])

  // Welcome tour: shown automatically on the first visit.
  const [tourOpen, setTourOpen] = React.useState(
    () => !localStorage.getItem(TOUR_KEY)
  )
  const setTour = (open: boolean) => {
    setTourOpen(open)
    if (!open) localStorage.setItem(TOUR_KEY, "1")
  }

  // How each section's chords are voiced (inversions), by section id.
  const voicingsById = React.useMemo(
    () =>
      new Map(
        song.sections.map((s) => [
          s.id,
          voiceChords(
            s.chords,
            sectionKey(song.key, s.transpose),
            song.voiceLeading
          ),
        ])
      ),
    [song.sections, song.key, song.voiceLeading]
  )
  const voicings = voicingsById.get(section.id) ?? []

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

  // ---- Pages: the song editor, and turning a recording into MIDI
  const [page, setPage] = React.useState<"song" | "audio">("song")
  /** An audio file dropped or picked anywhere, for the Audio to MIDI page. */
  const [droppedAudio, setDroppedAudio] = React.useState<{
    file: File
    n: number
  } | null>(null)
  // Once opened, the page stays mounted (hidden) so its results survive a
  // trip to the song.
  const [audioVisited, setAudioVisited] = React.useState(false)
  const changePage = (next: string) => {
    // What's playing belongs to the page being left.
    player.stop()
    setPage(next === "audio" ? "audio" : "song")
    if (next === "audio") setAudioVisited(true)
  }
  const fileRef = React.useRef<HTMLInputElement>(null)

  // ---- MIDI keyboard: play-through and chord input
  const [tab, setTab] = React.useState("chords")
  const [playThrough, setPlayThrough] = React.useState(true)
  const [chordInput, setChordInput] = React.useState(false)
  const downRef = React.useRef(new Set<number>())
  const releasesRef = React.useRef(new Map<number, Release | void>())
  const chordNotesRef = React.useRef<number[]>([])

  const addChordFromKeys = (pitches: number[]) => {
    const guess = chordFromPitches(pitches, editKey)
    if (!guess) return
    const chord: Chord = {
      id: uid(),
      degree: guess.degree,
      type: guess.type,
      inversion: guess.inversion,
      beats: bar,
      ...(guess.mode ? { mode: guess.mode } : {}),
      ...(guess.secondary ? { secondary: true } : {}),
    }
    patchSection({ chords: [...section.chords, chord] })
    toast.success(`Added ${chordName(chord, editKey)}`)
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

  // What to loop: bars dragged on the timeline, or one part of the form
  // (which follows that part when the form changes).
  const [loopTarget, setLoopTarget] = React.useState<
    LoopRange | { slot: string } | null
  >(null)
  const loopSlot =
    loopTarget && "slot" in loopTarget
      ? placed.find((p) => p.slot.id === loopTarget.slot && p.beats > 0)
      : undefined
  const loopRangeRaw: LoopRange | null = loopSlot
    ? { start: loopSlot.start, end: loopSlot.start + loopSlot.beats }
    : loopTarget && "start" in loopTarget
      ? loopTarget
      : null
  // Ignored if the song got shorter than it.
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
      song.sections,
      song.arrangement,
      song.chordStyle,
      song.meter,
      song.bass,
      song.voiceLeading,
      song.swing,
      song.humanize,
      song.bassStyle,
      song.crashOnChange,
      song.ending,
    ]
  )
  const clicks = React.useMemo(() => clickBeats(song, placed), [song, placed])
  const playSettings = (
    opts: { loop?: boolean; range?: LoopRange | null } = {}
  ): PlaySettings => {
    const range = opts.range === undefined ? loopRange : opts.range
    return {
      events,
      bpm: song.bpm,
      tempo: hasTempoChanges(tempo) ? tempo : undefined,
      // The ending plays after the form, unless the song loops round.
      end: (opts.loop ?? loop) ? beats : beats + endingBeats(song),
      loop: opts.loop ?? loop,
      loopStart: range?.start,
      loopEnd: range?.end,
      instruments: song.instruments,
      clicks: metronome ? clicks : undefined,
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

  // Where the playhead is: which part of the form, and which chord in it.
  const playing = player.beat === null ? null : placedAt(placed, player.beat)
  let playingChord: Chord | null = null
  if (playing && player.beat !== null) {
    let t = playing.start
    for (const c of playing.section.chords) {
      if (player.beat < t + c.beats) {
        playingChord = c
        break
      }
      t += c.beats
    }
  }
  // The editors show the playhead only while the open section plays.
  const localBeat =
    playing && player.beat !== null && playing.section.id === section.id
      ? player.beat - playing.start
      : null
  const activeChordId = localBeat !== null ? (playingChord?.id ?? null) : null

  // Linking melodies across sections (Melody tab, Sections menu).
  const sectionLabel = (s: Section) =>
    `${sectionLetter(song.sections.indexOf(s))} · ${s.name}`
  const melodySources: MelodySource[] = song.sections
    .filter((s) => s.id !== section.id && s.melody.length && s.chords.length)
    .map((s) => ({
      id: s.id,
      label: sectionLabel(s),
      chords: s.chords,
      melody: s.melody,
    }))
  const leadTargets: LeadTarget[] = []
  placed.forEach((p, i) => {
    if (p.section.id !== section.id) return
    const next = placed.slice(i + 1).find((q) => q.beats > 0)
    if (!next?.section.melody.length) return
    if (leadTargets.some((t) => t.id === next.section.id)) return
    const first = next.section.melody.reduce((a, b) =>
      b.start < a.start ? b : a
    )
    const nextKey = sectionKey(song.key, next.section.transpose)
    const pitch = degreeToMidi(first.degree, nextKey, melodyBase(nextKey))
    leadTargets.push({
      id: next.section.id,
      label:
        next.section.id === section.id
          ? `${sectionLabel(next.section)} (again)`
          : sectionLabel(next.section),
      degree: foldDegree(nearestDegree(pitch, editKey)),
    })
  })

  const timelineParts: TimelinePart[] = placed.map((p) => {
    const index = song.sections.indexOf(p.section)
    const v = voicingsById.get(p.section.id)
    return {
      slotId: p.slot.id,
      sectionId: p.section.id,
      letter: sectionLetter(index),
      name: p.section.name,
      colorIndex: index,
      start: p.start,
      beats: p.beats,
      chords: p.section.chords.map((c, i) =>
        v?.[i] ? { ...c, inversion: v[i].inversion } : c
      ),
      ...(p.section.transpose
        ? { musicKey: sectionKey(song.key, p.section.transpose) }
        : {}),
    }
  })

  const playFrom = (
    from: number,
    opts: { loop?: boolean; range?: LoopRange | null; countIn?: boolean } = {}
  ) => {
    if (!beats) return toast.error("Add at least one chord first.")
    // Count in a bar of the time the music starts in.
    const at = placedAt(placed, from)
    const countMeter = at ? sectionMeter(song, at.section) : meter
    void player.play(
      playSettings(opts),
      from,
      opts.countIn
        ? { beats: barBeats(countMeter), clicks: pulses(countMeter) }
        : undefined
    )
  }

  const togglePlay = () => {
    if (player.playing || player.loading) return player.stop()
    playFrom(loop && loopRange ? loopRange.start : 0, { countIn })
  }

  const changeLoopRange = (range: LoopRange | null) => {
    setLoopTarget(range)
    if (range) {
      setLoop(true)
      playFrom(range.start, { loop: true, range })
    } // Clearing the range: the running player just carries on over the whole song.
  }

  /** Move the song to another time signature. A loop over bars is let go:
   *  its beats no longer line up with them. */
  const changeMeter = (id: MeterId) => {
    history.set((s) => setMeter(s, id))
    if (loopTarget && "start" in loopTarget) setLoopTarget(null)
    toast.success(`Now in ${id}`, {
      description:
        "Chord lengths, melodies and drum beats were fitted to the new bar.",
    })
  }

  /** Loop one part of the form (null: stop looping it). */
  const loopPart = (slotId: string | null) => {
    const p = placed.find((x) => x.slot.id === slotId)
    if (!p) return changeLoopRange(null)
    setLoopTarget({ slot: p.slot.id })
    setLoop(true)
    playFrom(p.start, {
      loop: true,
      range: { start: p.start, end: p.start + p.beats },
    })
  }

  // ---- Song library: switching songs, examples, share links
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  const [entries, setEntries] = React.useState<LibraryEntry[]>([])
  const [listedAt, setListedAt] = React.useState(0)
  const refreshList = () => {
    setEntries(library.list())
    setListedAt(clock())
  }
  const showLibrary = () => {
    refreshList()
    setLibraryOpen(true)
  }
  // An example or blank song opened as a new song is dropped again if you
  // move on without changing it, so trying examples doesn't fill the list.
  const scratchRef = React.useRef<{ id: string; song: Song } | null>(null)

  // The open song as of the last render. Toast buttons (Back, Undo, Open)
  // run after other switches, so they read this rather than their own render.
  const openRef = React.useRef({ id: songId, song })
  React.useLayoutEffect(() => {
    openRef.current = { id: songId, song }
  })

  const songById = (id: string) =>
    id === openRef.current.id ? openRef.current.song : library.load(id)

  const switchTo = (id: string, next: Song) => {
    const open = openRef.current
    const scratch = scratchRef.current
    if (
      scratch &&
      scratch.id === open.id &&
      scratch.song === open.song &&
      id !== open.id
    )
      library.remove(open.id)
    scratchRef.current = null
    player.stop()
    openedRef.current = next
    history.reset(next)
    setSongId(id)
    setSelectedId(null)
    setLoopTarget(null)
    library.setCurrent(id)
  }

  const openSong = (id: string) => {
    const next = songById(id)
    if (!next) {
      refreshList()
      return toast.error("That song is no longer in My songs.")
    }
    switchTo(id, next)
    setLibraryOpen(false)
  }

  /** Add a song to the library and open it. */
  const openNew = (
    next: Song,
    opts: { label: string; scratch?: boolean; description?: string }
  ) => {
    const back = openRef.current.id
    const id = library.add(next)
    switchTo(id, next)
    if (opts.scratch) scratchRef.current = { id, song: next }
    setLibraryOpen(false)
    toast.success(`Opened ${opts.label}`, {
      description:
        opts.description ??
        (opts.scratch
          ? "As a new song. It's kept in My songs once you change it."
          : "Added to My songs."),
      action: { label: "Back", onClick: () => openSong(back) },
    })
  }

  const loadExample = (ex: Example) =>
    openNew(ex.build(), { label: `“${ex.label}”`, scratch: true })
  const newSong = () =>
    openNew(blankSong(song), { label: "a new song", scratch: true })

  const renameSong = (id: string, title: string) => {
    if (id === songId) patch({ title })
    else {
      const s = library.load(id)
      if (s) library.save(id, { ...s, title })
    }
    // The list reads storage; let the save effect run first for the open song.
    setTimeout(refreshList, 0)
  }

  const duplicateSong = (id: string) => {
    const s = songById(id)
    if (!s) return
    const copyId = library.add({
      ...s,
      title: `${s.title} (copy)`.slice(0, 60),
    })
    refreshList()
    toast.success(`Duplicated “${s.title}”`, {
      action: { label: "Open", onClick: () => openSong(copyId) },
    })
  }

  const downloadSong = (id: string) => {
    const s = songById(id)
    if (s)
      downloadBytes(
        songFile([s]),
        `${fileSlug(s.title)}.json`,
        "application/json"
      )
  }

  const deleteSong = (id: string) => {
    const s = songById(id)
    if (!s) return
    const wasOpen = id === songId
    library.remove(id)
    if (wasOpen) {
      const next = library.list()[0]
      const nextSong = next && library.load(next.id)
      if (next && nextSong) switchTo(next.id, nextSong)
      else {
        const blank = blankSong(s)
        switchTo(library.add(blank), blank)
      }
    }
    refreshList()
    toast(`Deleted “${s.title}”`, {
      action: {
        label: "Undo",
        onClick: () => {
          library.save(id, s)
          if (wasOpen) openSong(id)
          refreshList()
        },
      },
    })
  }

  const backupAll = () => {
    const songs = library
      .list()
      .map((e) => songById(e.id))
      .filter((x): x is Song => !!x)
    const date = new Date().toISOString().slice(0, 10)
    downloadBytes(
      songFile(songs),
      `chord-creator-backup-${date}.json`,
      "application/json"
    )
    toast.success(
      `Backed up ${songs.length} ${songs.length === 1 ? "song" : "songs"}`
    )
  }

  // Share links: the whole song is packed into the link's #hash.
  const [manualShare, setManualShare] = React.useState<string | null>(null)
  const [chartOpen, setChartOpen] = React.useState(false)
  const shareSong = async () => {
    const url = await shareUrl(song, window.location.href)
    const long = url.length > 8000
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Share link copied", {
        description: long
          ? "This song makes a very long link that some apps may cut off. A song file is safer."
          : `Anyone who opens it gets their own copy of “${song.title}”.`,
      })
    } catch {
      setManualShare(url)
    }
  }
  const onShareHash = React.useEffectEvent(async () => {
    const code = shareCode(window.location.hash)
    if (!code) return
    // Clear the link first, so a reload doesn't add the song again.
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search
    )
    try {
      const shared = await decodeShare(code)
      openNew(shared, {
        label: `“${shared.title}”`,
        description: "A shared song, now saved in My songs.",
      })
    } catch (err) {
      toast.error("Couldn't open the shared song", {
        description: err instanceof SongFileError ? err.message : undefined,
      })
    }
  })
  React.useEffect(() => {
    // After mount (and only once under StrictMode, whose first run is cancelled).
    const first = setTimeout(() => void onShareHash())
    const onHash = () => void onShareHash()
    window.addEventListener("hashchange", onHash)
    return () => {
      clearTimeout(first)
      window.removeEventListener("hashchange", onHash)
    }
  }, [])

  // ---- Opening files: MIDI or song files (or a recording, for the Audio to
  // MIDI page), by button or drop
  const openFile = (file: File) => {
    if (/\.json$/i.test(file.name)) void onSongFile(file)
    else if (/\.midi?$/i.test(file.name)) void openMidiFile(file)
    else if (isAudioFile(file)) {
      changePage("audio")
      setDroppedAudio((d) => ({ file, n: (d?.n ?? 0) + 1 }))
    } else
      toast.error(`Can't open ${file.name}`, {
        description:
          "Choose a MIDI file (.mid), a Static Sound song file (.json) or a recording (.wav) to turn into MIDI.",
      })
  }
  const onSongFile = React.useEffectEvent(async (file: File) => {
    try {
      const songs = parseSongFile(await file.text())
      if (songs.length === 1)
        return openNew(songs[0], { label: `“${songs[0].title}”` })
      // Restoring a backup twice shouldn't double every song.
      const have = library
        .list()
        .map((e) => songById(e.id))
        .filter((x): x is Song => !!x)
      const fresh = songs.filter((s) => !have.some((h) => sameSong(h, s)))
      for (const s of fresh) library.add(s)
      refreshList()
      setLibraryOpen(true)
      const skipped = songs.length - fresh.length
      toast.success(
        fresh.length
          ? `Added ${fresh.length} ${fresh.length === 1 ? "song" : "songs"} to My songs`
          : "You already have all of these songs",
        {
          description:
            skipped && fresh.length
              ? `${skipped} were already in My songs.`
              : undefined,
        }
      )
    } catch (err) {
      toast.error(`Couldn't open ${file.name}`, {
        description:
          err instanceof SongFileError
            ? err.message
            : "The file doesn't look like a Static Sound song.",
      })
    }
  })
  const openMidiFile = async (file: File) => {
    try {
      const { parseMidi } = await import("@/lib/midi-import")
      const midi = parseMidi(await file.arrayBuffer())
      setPendingImport({ filename: file.name, midi })
    } catch (err) {
      toast.error(`Couldn't read ${file.name}`, {
        description:
          err instanceof Error && err.name === "MidiParseError"
            ? err.message
            : "The file doesn't look like a valid MIDI file.",
      })
    }
  }
  const openDropped = React.useEffectEvent((file: File) => openFile(file))
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
      openDropped(file)
    }
    window.addEventListener("dragover", over)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragover", over)
      window.removeEventListener("drop", drop)
    }
  }, [])

  // Space bar = play / stop (unless typing or using a control that needs it).
  // (The Audio to MIDI page has no song to play, but Space still stops.)
  const onSpace = React.useEffectEvent(() =>
    page === "song" ? togglePlay() : player.stop()
  )
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

  const exportName = (ext: string) =>
    `${fileSlug(song.title)}${scope === "all" ? "" : `_${scope}`}.${ext}`

  const exportWav = async () => {
    const events = buildEvents(song, SCOPE_LAYERS[scope])
    if (!events.length) return toast.error("Nothing to export yet.")
    setRendering({ kind: "wav", stage: "loading", fraction: 0 })
    try {
      const { audibleTracks, encodeWav, renderSong } =
        await import("@/lib/render")
      if (!audibleTracks(events, song.mix).length) {
        toast.error("Those tracks are muted. Unmute them to export audio.")
        return
      }
      const out = await renderSong({
        events,
        bpm: song.bpm,
        tempo,
        end: beats + endingBeats(song),
        instruments: song.instruments,
        mix: song.mix,
        reverb: song.reverb,
        onProgress: (stage, fraction) =>
          setRendering({ kind: "wav", stage, fraction }),
      })
      const filename = exportName("wav")
      downloadBytes(
        encodeWav(out.channels, out.sampleRate),
        filename,
        "audio/wav"
      )
      const secs = Math.round(out.channels[0].length / out.sampleRate)
      toast.success(`Exported ${filename}`, {
        description: out.fallbacks.length
          ? `${out.fallbacks.join(", ")} couldn't load, so the built-in synth plays instead.`
          : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} of 44.1 kHz stereo audio.`,
      })
    } catch (err) {
      console.error(err)
      toast.error("Couldn't render the audio.", {
        description: "Your browser may not support offline audio rendering.",
      })
    } finally {
      setRendering(null)
    }
  }

  const exportStems = async () => {
    const events = buildEvents(song, SCOPE_LAYERS.all)
    if (!events.length) return toast.error("Nothing to export yet.")
    setRendering({ kind: "stems", stage: "loading", fraction: 0 })
    try {
      const [{ audibleTracks, encodeWav, renderStems }, { buildZip }] =
        await Promise.all([import("@/lib/render"), import("@/lib/zip")])
      if (!audibleTracks(events, song.mix).length) {
        toast.error("Every track is muted. Unmute some to export stems.")
        return
      }
      const out = await renderStems({
        events,
        bpm: song.bpm,
        tempo,
        end: beats + endingBeats(song),
        instruments: song.instruments,
        mix: song.mix,
        reverb: song.reverb,
        onProgress: (track, i, of, fraction) =>
          setRendering({
            kind: "stems",
            label: `${TRACK_TITLES[track]} ${i + 1}/${of}`,
            stage: "rendering",
            fraction,
          }),
      })
      const slug = fileSlug(song.title)
      const filename = `${slug}_stems.zip`
      downloadBytes(
        buildZip(
          out.stems.map((s) => ({
            name: `${slug}_${s.track}.wav`,
            data: encodeWav(s.channels, out.sampleRate),
          }))
        ),
        filename,
        "application/zip"
      )
      const secs = Math.round(
        (out.stems[0]?.channels[0].length ?? 0) / out.sampleRate
      )
      toast.success(`Exported ${filename}`, {
        description: out.fallbacks.length
          ? `${out.fallbacks.join(", ")} couldn't load, so the built-in synth plays instead.`
          : `${out.stems.map((s) => TRACK_TITLES[s.track]).join(", ")}: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} each, lined up from the start.`,
      })
    } catch (err) {
      console.error(err)
      toast.error("Couldn't render the stems.", {
        description: "Your browser may not support offline audio rendering.",
      })
    } finally {
      setRendering(null)
    }
  }

  const exportMidi = () => {
    const events = buildEvents(song, SCOPE_LAYERS[scope])
    if (!events.length) return toast.error("Nothing to export yet.")
    const filename = exportName("mid")
    const meters = meterChanges(song, placed)
    downloadBytes(
      buildMidi(events, {
        bpm: song.bpm,
        tempo,
        title: song.title,
        keySig: keySignature(song.key),
        keyChanges: keyChanges(song.key, placed),
        timeSig: midiTimeSig(meters[0].meter),
        timeSigChanges: meters
          .slice(1)
          .map((t) => ({ beat: t.beat, timeSig: midiTimeSig(t.meter) })),
        markers:
          song.arrangement.length > 1
            ? placed.map((p) => ({
                beat: p.start,
                text: p.section.name,
              }))
            : undefined,
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
      <a
        href="#editor"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to the editor
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-3 py-2.5 sm:gap-1.5 sm:px-4 sm:py-3 lg:gap-3">
          <Logo className="hidden size-9 shrink-0 text-foreground lg:block" />
          <div className="mr-auto min-w-20">
            <h1 className="text-xs leading-tight text-muted-foreground max-sm:sr-only">
              Static Sound
            </h1>
            <SongTitle
              title={song.title}
              onRename={(title) => patch({ title })}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".mid,.midi,audio/midi,audio/x-midi,.json,application/json"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) openFile(file)
            }}
          />
          <Button
            variant="ghost"
            className="hidden max-lg:size-9 max-lg:px-0 sm:inline-flex"
            aria-label="My songs"
            title="Open, rename, back up and delete your songs"
            onClick={showLibrary}
          >
            <FolderOpenIcon />
            <span className="hidden lg:inline">Songs</span>
          </Button>
          <Button
            variant="ghost"
            className="hidden max-lg:size-9 max-lg:px-0 sm:inline-flex"
            aria-label="Import MIDI file"
            title="Import a MIDI or song file (or drop one anywhere)"
            onClick={() => fileRef.current?.click()}
          >
            <UploadIcon />
            <span className="hidden lg:inline">Import</span>
          </Button>
          <MidiKeyboardMenu
            playThrough={playThrough}
            onPlayThrough={setPlayThrough}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="max-lg:size-9 max-lg:px-0"
                aria-label="Examples and more"
              >
                <LibraryIcon className="max-sm:hidden" />
                <EllipsisVerticalIcon className="sm:hidden" />
                <span className="hidden lg:inline">Examples</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {/* On phones the header has no room, so these live here. */}
              <div className="sm:hidden">
                <DropdownMenuItem onSelect={showLibrary}>
                  <FolderOpenIcon /> My songs
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                  <UploadIcon /> Import a file
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!history.canRedo}
                  onSelect={history.redo}
                >
                  <Redo2Icon /> Redo
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setTheme(isDark ? "light" : "dark")}
                >
                  {isDark ? <SunIcon /> : <MoonIcon />}
                  {isDark ? "Light theme" : "Dark theme"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </div>
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
              <DropdownMenuItem onSelect={newSong}>
                <FilePlusIcon /> New song
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTour(true)}>
                <CircleHelpIcon /> Take the tour
              </DropdownMenuItem>
              {installHow && (
                <DropdownMenuItem onSelect={() => void installApp()}>
                  <MonitorDownIcon /> Install app
                </DropdownMenuItem>
              )}
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
            className="sm:w-24 lg:w-28"
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

      <Tabs value={page} onValueChange={changePage} className="block">
        <nav
          aria-label="Pages"
          className="mx-auto max-w-7xl px-3 pt-3 sm:px-4 sm:pt-4"
        >
          <TabsList variant="line">
            <TabsTrigger value="song" className="px-2.5">
              <Music2Icon /> Song
            </TabsTrigger>
            <TabsTrigger value="audio" className="px-2.5">
              <AudioWaveformIcon /> Audio to MIDI
            </TabsTrigger>
          </TabsList>
        </nav>
        <main id="editor" tabIndex={-1} className="outline-none">
          {/* Plain panels: the tabs' own content style would shrink the text.
            Not focusable themselves: they're full of controls. */}
          <TabsPrimitive.Content
            value="audio"
            forceMount={audioVisited || undefined}
            tabIndex={-1}
            className="px-3 py-4 outline-none data-[state=inactive]:hidden sm:px-4 sm:py-6"
          >
            <React.Suspense
              fallback={
                <div className="flex justify-center py-16 text-muted-foreground">
                  <Loader2Icon className="animate-spin" />
                </div>
              }
            >
              <AudioToMidi
                player={player}
                instruments={song.instruments}
                dropped={droppedAudio}
                onOpenAsSong={(midi, filename) => {
                  changePage("song")
                  setPendingImport({ filename, midi, arrange: true })
                }}
              />
            </React.Suspense>
          </TabsPrimitive.Content>
          <TabsPrimitive.Content
            value="song"
            tabIndex={-1}
            className="mx-auto grid max-w-7xl gap-4 px-3 py-4 outline-none sm:gap-6 sm:px-4 sm:py-6 lg:grid-cols-[300px_1fr]"
          >
            <aside className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-4 lg:self-start">
              <Card className="order-2 lg:order-none">
                <CardHeader>
                  <CardTitle>Key & Tempo</CardTitle>
                  <CardDescription>
                    Everything follows the key you choose.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="key-root">Key</Label>
                      <Select
                        value={String(song.key.root)}
                        onValueChange={(v) =>
                          patch({ key: { ...song.key, root: Number(v) } })
                        }
                      >
                        <SelectTrigger id="key-root" className="w-full">
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
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="meter">Time signature</Label>
                    <Select
                      value={meter.id}
                      onValueChange={(v) => changeMeter(v as MeterId)}
                    >
                      <SelectTrigger id="meter" size="sm" className="w-24">
                        <SelectValue>{meter.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end">
                        {METERS.map((m) => (
                          <SelectItem
                            key={m.id}
                            value={m.id}
                            textValue={m.label}
                          >
                            <span className="flex flex-col">
                              <span className="font-medium">{m.label}</span>
                              <span className="text-xs text-muted-foreground">
                                {m.hint}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <TempoControl
                    bpm={song.bpm}
                    onChange={(bpm, coalesce) =>
                      patch({ bpm }, coalesce ? { coalesce: "bpm" } : undefined)
                    }
                  >
                    {hasTempoChanges(tempo) && (
                      <p className="text-xs text-muted-foreground">
                        Some sections change it (see Section style).
                      </p>
                    )}
                  </TempoControl>
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor="metronome"
                      className="flex flex-col items-start gap-0.5"
                    >
                      Metronome
                      <span className="text-xs font-normal text-muted-foreground">
                        Clicks on the beat while playing (not in exports)
                      </span>
                    </Label>
                    <Switch
                      id="metronome"
                      checked={metronome}
                      onCheckedChange={setMetronome}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor="count-in"
                      className="flex flex-col items-start gap-0.5"
                    >
                      Count-in
                      <span className="text-xs font-normal text-muted-foreground">
                        A bar of clicks before Play starts
                      </span>
                    </Label>
                    <Switch
                      id="count-in"
                      checked={countIn}
                      onCheckedChange={setCountIn}
                    />
                  </div>
                  <FeelGroup
                    summary={[
                      chordStyleLabel(song.chordStyle),
                      song.swing
                        ? `swing ${Math.round(song.swing * 100)}%`
                        : "",
                      song.humanize
                        ? `humanize ${Math.round(song.humanize * 100)}%`
                        : "",
                      song.voiceLeading ? "smooth voice leading" : "",
                      song.bass
                        ? `${bassLabel(song.bassStyle).toLowerCase()} bass`
                        : "no bass",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <FeelSlider
                      label="Swing"
                      hint="Delays the off-beats for a shuffle or groove feel"
                      value={song.swing ?? 0}
                      onChange={(swing) =>
                        patch(
                          { swing: swing || undefined },
                          { coalesce: "swing" }
                        )
                      }
                    />
                    <FeelSlider
                      label="Humanize"
                      hint="Small changes in timing and loudness, like a live player"
                      value={song.humanize ?? 0}
                      onChange={(humanize) =>
                        patch(
                          { humanize: humanize || undefined },
                          { coalesce: "humanize" }
                        )
                      }
                    />
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="chord-rhythm">Chord rhythm</Label>
                      <Select
                        value={song.chordStyle}
                        onValueChange={(v) =>
                          patch({ chordStyle: v as ChordStyle })
                        }
                      >
                        <SelectTrigger id="chord-rhythm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHORD_STYLES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {chordStyleHint(song.chordStyle)}
                      </p>
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
                        onCheckedChange={(voiceLeading) =>
                          patch({ voiceLeading })
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="bass">Bass line</Label>
                        <Switch
                          id="bass"
                          checked={song.bass}
                          onCheckedChange={(bass) => patch({ bass })}
                        />
                      </div>
                      {song.bass && (
                        <>
                          <Select
                            value={song.bassStyle ?? "root"}
                            onValueChange={(v) =>
                              patch({
                                bassStyle:
                                  v === "root" ? undefined : (v as BassStyle),
                              })
                            }
                          >
                            <SelectTrigger
                              aria-label="Bass pattern"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {BASS_STYLES.map((b) => (
                                <SelectItem key={b.value} value={b.value}>
                                  {b.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {bassHint(song.bassStyle)}
                          </p>
                        </>
                      )}
                    </div>
                  </FeelGroup>
                </CardContent>
              </Card>

              <div className="order-3 lg:order-none">
                <SoundPanel
                  instruments={song.instruments}
                  mix={song.mix}
                  reverb={song.reverb}
                  bassEnabled={song.bass}
                  drumsEnabled={anyDrums}
                  status={player.status}
                  onInstrument={setInstrument}
                  onMix={setMix}
                  onReverb={(reverb) =>
                    patch({ reverb }, { coalesce: "reverb" })
                  }
                />
              </div>

              <Card className="order-4 lg:order-none">
                <CardHeader>
                  <CardTitle>Export</CardTitle>
                  <CardDescription>
                    {song.sections.length}{" "}
                    {song.sections.length === 1 ? "section" : "sections"} ·{" "}
                    {+songBars(song).toFixed(1)}{" "}
                    {songBars(song) === 1 ? "bar" : "bars"} · {formString(song)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Select
                    value={scope}
                    onValueChange={(v) => setScope(v as ExportScope)}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label="What to export"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        Everything{" "}
                        {[
                          "chords",
                          "melody",
                          song.bass && "bass",
                          anyDrums && "drums",
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
                      <SelectItem value="drums" disabled={!anyDrums}>
                        Drums only
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="lg" onClick={exportMidi}>
                      <DownloadIcon /> MIDI
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={exportWav}
                      disabled={!!rendering}
                    >
                      {rendering?.kind === "wav" ? (
                        <>
                          <Loader2Icon className="animate-spin" />
                          {rendering.stage === "loading"
                            ? "Loading…"
                            : `${Math.round(rendering.fraction * 100)}%`}
                        </>
                      ) : (
                        <>
                          <AudioLinesIcon /> WAV
                        </>
                      )}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void exportStems()}
                    disabled={!!rendering}
                    title="One WAV file per track, in a zip, for mixing in a DAW"
                  >
                    {rendering?.kind === "stems" ? (
                      <>
                        <Loader2Icon className="animate-spin" />
                        {rendering.label ?? "Loading…"}
                        {rendering.label &&
                          ` · ${Math.round(rendering.fraction * 100)}%`}
                      </>
                    ) : (
                      <>
                        <LayersIcon /> Stems (WAV per track)
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setChartOpen(true)}>
                    <FileMusicIcon /> Chord chart
                  </Button>
                  <Button variant="secondary" onClick={() => void shareSong()}>
                    <LinkIcon /> Copy share link
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    MIDI keeps separate tracks, tempo and key for your DAW. WAV
                    is the finished sound — your instruments, mix and reverb.
                    Stems are one WAV per track in a zip, lined up to mix in a
                    DAW. A chord chart is the chords bar by bar, to print or
                    copy. A share link sends the whole song for others to open
                    and edit.
                  </p>
                </CardContent>
              </Card>
            </aside>

            {/* On phones the music comes first, then the settings. */}
            <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-none">
              <SongForm
                song={song}
                placed={placed}
                selectedId={section.id}
                playingSlotId={playing?.slot.id ?? null}
                loopSlotId={loop ? (loopSlot?.slot.id ?? null) : null}
                onSelect={setSelectedId}
                onChange={(next) => history.set(next)}
                onLoopSlot={loopPart}
                onPlayFrom={(beat) => playFrom(beat)}
              />
              <Timeline
                musicKey={song.key}
                barLines={barLines(song, placed)}
                parts={timelineParts}
                playheadBeat={
                  player.beat === null ? null : Math.min(player.beat, beats)
                }
                loopRange={loopRange}
                activeChordKey={
                  playing && playingChord
                    ? `${playing.slot.id}:${playingChord.id}`
                    : null
                }
                selectedSectionId={section.id}
                onSelectSection={setSelectedId}
                onSeek={(beat) => playFrom(beat)}
                onLoopChange={changeLoopRange}
              />
              <Tabs value={tab} onValueChange={setTab} className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="chords">Chords</TabsTrigger>
                    <TabsTrigger value="melody">Melody</TabsTrigger>
                    <TabsTrigger value="drums">Drums</TabsTrigger>
                  </TabsList>
                  <EditingBadge
                    letter={sectionLetter(sectionIndex)}
                    colorIndex={sectionIndex}
                    name={section.name}
                    count={
                      song.arrangement.filter((s) => s.section === section.id)
                        .length
                    }
                    notes={sectionStyleSummary(section, {
                      bass: song.bass,
                      anyDrums,
                      musicKey: song.key,
                    })}
                  />
                  <SectionSettings
                    section={section}
                    musicKey={song.key}
                    songChordStyle={song.chordStyle}
                    songBassStyle={song.bassStyle ?? "root"}
                    songBpm={song.bpm}
                    songMeter={song.meter}
                    bass={song.bass}
                    onChange={patchSectionStyle}
                  />
                </div>
                {!!section.transpose && (
                  <p className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    This section plays {Math.abs(section.transpose)}{" "}
                    {Math.abs(section.transpose) === 1
                      ? "semitone"
                      : "semitones"}{" "}
                    {section.transpose > 0 ? "higher" : "lower"}, in{" "}
                    <span className="font-medium text-foreground">
                      {keyLabel(editKey)}
                    </span>
                    , so the chords and notes below are shown in that key. The
                    song is in {keyLabel(song.key)}.
                  </p>
                )}
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
                    musicKey={editKey}
                    meter={editMeter}
                    chords={section.chords}
                    onChange={(chords) => {
                      // Trim melody notes that now fall past the end of the progression.
                      const end = totalBeats(chords) * STEPS_PER_BEAT
                      const melody = section.melody
                        .filter((n) => n.start < end)
                        .map((n) => ({
                          ...n,
                          length: Math.min(n.length, end - n.start),
                        }))
                      patchSection({ chords, melody })
                    }}
                    activeChordId={activeChordId}
                    onPreview={(m) =>
                      void player.preview(m, "chords", song.instruments.chords)
                    }
                  />
                </TabsContent>
                <TabsContent value="melody" className="mt-2">
                  <MelodyEditor
                    musicKey={editKey}
                    sources={melodySources}
                    leadTargets={leadTargets}
                    key={section.id}
                    chords={section.chords}
                    melody={section.melody}
                    onChange={(melody) => patchSection({ melody })}
                    barSteps={barSteps(editMeter)}
                    playheadBeat={localBeat}
                    onPreview={(m) =>
                      void player.preview(
                        [m],
                        "melody",
                        song.instruments.melody
                      )
                    }
                  />
                </TabsContent>
                <TabsContent value="drums" className="mt-2">
                  <DrumEditor
                    drums={section.drums}
                    meter={editMeter}
                    onChange={(drums) => patchSection({ drums })}
                    crashOnChange={!!song.crashOnChange}
                    onCrashOnChange={(on) =>
                      patch({ crashOnChange: on || undefined })
                    }
                    playheadBeat={player.playing ? localBeat : null}
                    onPreview={(m) =>
                      void player.preview([m], "drums", song.instruments.drums)
                    }
                  />
                </TabsContent>
              </Tabs>
            </div>
          </TabsPrimitive.Content>
        </main>
      </Tabs>
      <MountWhen when={tourOpen}>
        <WelcomeTour
          open={tourOpen}
          onOpenChange={setTour}
          onTryExample={() => loadExample(EXAMPLES[0])}
        />
      </MountWhen>
      <MountWhen when={!!pendingImport}>
        <ImportDialog
          pending={pendingImport}
          song={song}
          onCancel={() => setPendingImport(null)}
          onImport={(next, label) => {
            const name = pendingImport?.filename ?? "Imported song"
            setPendingImport(null)
            openNew({ ...next, title: titleFromFile(name) }, { label })
          }}
        />
      </MountWhen>
      <MountWhen when={libraryOpen}>
        <SongLibrary
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          entries={entries}
          now={listedAt}
          currentId={songId}
          onOpen={openSong}
          onNew={newSong}
          onRename={renameSong}
          onDuplicate={duplicateSong}
          onDownload={downloadSong}
          onDelete={deleteSong}
          onBackup={backupAll}
          onImport={() => fileRef.current?.click()}
        />
      </MountWhen>
      <MountWhen when={chartOpen}>
        <ChordChartDialog
          open={chartOpen}
          onOpenChange={setChartOpen}
          song={song}
        />
      </MountWhen>
      <MountWhen when={!!manualShare}>
        <ShareLinkDialog
          url={manualShare}
          onClose={() => setManualShare(null)}
        />
      </MountWhen>
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

/** Which section the editors below are showing. */
function EditingBadge({
  letter,
  colorIndex,
  name,
  count,
  notes = [],
}: {
  letter: string
  colorIndex: number
  name: string
  count: number
  /** How the section is played differently, e.g. "no drums". */
  notes?: string[]
}) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      Editing
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded text-[11px] font-bold",
          sectionColor(colorIndex).letter
        )}
      >
        {letter}
      </span>
      <span className="font-medium text-foreground">{name}</span>
      {count > 1 && <span>· plays {count}×</span>}
      {count === 0 && <span>· not in the song</span>}
      {notes.length > 0 && <span>· {notes.join(" · ")}</span>}
    </p>
  )
}

/**
 * The finer settings of how the song plays, folded away on phones (with a
 * summary of them) so the music comes first; open on bigger screens.
 */
function FeelGroup({
  summary,
  children,
}: {
  summary: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(
    () => window.matchMedia?.("(min-width: 1024px)").matches ?? true
  )
  const id = React.useId()
  return (
    <div className="flex flex-col gap-4 border-t pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="-mx-1 flex items-start justify-between gap-2 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">Feel & arrangement</span>
          {!open && (
            <span className="text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  )
}

function FeelSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="flex justify-between" title={hint}>
        {label}
        <span className="font-mono text-muted-foreground">
          {value ? `${Math.round(value * 100)}%` : "off"}
        </span>
      </Label>
      <Slider
        aria-label={label}
        value={[value]}
        min={0}
        max={1}
        step={0.05}
        onValueChange={([v]) => onChange(Math.round(v * 100) / 100)}
      />
    </div>
  )
}

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
