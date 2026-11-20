import * as React from "react"
import {
  AudioLinesIcon,
  DownloadIcon,
  FileAudioIcon,
  Loader2Icon,
  MicIcon,
  PlayIcon,
  SquareIcon,
  SquarePenIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"

import { TempoControl } from "@/components/tempo-control"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  ANALYSIS_RATE,
  type FoundNote,
  HOP,
  MAX_FILE_BYTES,
  MAX_SECONDS,
  analyseFrames,
  decodeAudio,
  estimateTempo,
  framesToNotes,
  peaks,
  toEvents,
  toParsedMidi,
} from "@/lib/audio-to-midi"
import { isAudioFile } from "@/lib/audio-files"
import type { TrackInstruments } from "@/lib/instruments"
import { buildMidi, downloadBytes } from "@/lib/midi"
import { type ParsedMidi, guessKey } from "@/lib/midi-import"
import { keyLabel, keySignature, noteNameWithOctave } from "@/lib/music"
import {
  MicError,
  type Recorder,
  canRecord,
  startRecording,
  takeToFile,
} from "@/lib/recorder"
import { clampBpm } from "@/lib/tempo"
import type { PlaySettings } from "@/lib/use-player"
import { cn } from "@/lib/utils"

interface Player {
  play: (settings: PlaySettings, from: number) => Promise<void> | void
  stop: () => void
  playing: boolean
  loading: boolean
  beat: number | null
}

interface Props {
  player: Player
  instruments: TrackInstruments
  /** A file dropped anywhere in the app (changes each drop). */
  dropped: { file: File; n: number } | null
  onOpenAsSong: (midi: ParsedMidi, filename: string) => void
}

interface Loaded {
  file: File
  url: string
  samples: Float32Array
  duration: number
  wave: Float32Array
  /** Recorded to a click at this tempo (so no need to guess it). */
  bpm?: number
}

interface Result {
  notes: FoundNote[]
  /** The tempo guessed from the recording. */
  detected: number
  /** The tempo is the click's, not a guess. */
  clicked: boolean
}

type Status =
  | { state: "idle" }
  | { state: "working"; step: string; progress: number }
  | { state: "error"; message: string }

interface ClickSettings {
  on: boolean
  bpm: number
}
const CLICK_KEY = "chord-creator:record-click"
function loadClick(): ClickSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(CLICK_KEY) ?? "null")
    if (saved && typeof saved.on === "boolean" && Number.isFinite(saved.bpm))
      return { on: saved.on, bpm: clampBpm(saved.bpm) }
  } catch {
    /* fall through */
  }
  return { on: false, bpm: 100 }
}

interface RecordingState {
  seconds: number
  level: number
  full: boolean
  /** Beats since the first downbeat (negative in the count-in), with a click. */
  beat: number | null
}

const WAVE_WIDTH = 600
/** The longest take from the microphone (seconds). */
const MAX_RECORDING = 5 * 60
const base = (name: string) => name.replace(/\.[^.]+$/, "") || "Recording"
const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * The Audio to MIDI page: load a recording of one melody line, find its
 * notes, then listen, download them as MIDI or open them as a song.
 */
export function AudioToMidi({
  player,
  instruments,
  dropped,
  onOpenAsSong,
}: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [result, setResult] = React.useState<Result | null>(null)
  const [bpm, setBpm] = React.useState(120)
  const [sensitivity, setSensitivity] = React.useState(0.5)
  // Clicking along while recording (remembered between visits).
  const [click, setClick] = React.useState(loadClick)
  const { on: clickOn, bpm: clickBpm } = click
  const changeClick = (next: Partial<ClickSettings>) =>
    setClick((c) => {
      const out = { ...c, ...next }
      try {
        localStorage.setItem(CLICK_KEY, JSON.stringify(out))
      } catch {
        /* private mode: just don't remember */
      }
      return out
    })
  const [status, setStatus] = React.useState<Status>({ state: "idle" })
  const [over, setOver] = React.useState(false)
  const abort = React.useRef<AbortController | null>(null)
  const recorder = React.useRef<Recorder | null>(null)
  // Bumped by Cancel, so a microphone that answers late is let go.
  const attempt = React.useRef(0)
  // "starting" while the browser asks for the microphone.
  const [recording, setRecording] = React.useState<
    null | "starting" | RecordingState
  >(null)
  const working = status.state === "working"
  const busy = working || recording !== null

  // Forget the recording's object URL when it's replaced or the page goes.
  React.useEffect(() => {
    if (loaded) return () => URL.revokeObjectURL(loaded.url)
  }, [loaded])
  React.useEffect(
    () => () => {
      abort.current?.abort()
      recorder.current?.cancel()
      attempt.current++
    },
    []
  )

  // While recording, show the time and level.
  const live = recording !== null && recording !== "starting"
  React.useEffect(() => {
    if (!live) return
    let id = 0
    const tick = () => {
      const r = recorder.current
      if (r)
        setRecording((s) =>
          s && s !== "starting"
            ? { ...s, seconds: r.seconds(), level: r.level(), beat: r.beat() }
            : s
        )
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [live])

  const record = async () => {
    abort.current?.abort()
    player.stop()
    setStatus({ state: "idle" })
    setRecording("starting")
    const mine = ++attempt.current
    try {
      const r = await startRecording({
        click: clickOn ? { bpm: clickBpm, beatsPerBar: 4 } : undefined,
        maxSeconds: MAX_RECORDING,
        onLimit: () =>
          setRecording((s) =>
            s && s !== "starting" ? { ...s, full: true } : s
          ),
      })
      if (mine !== attempt.current) return r.cancel()
      recorder.current = r
      setRecording({
        seconds: 0,
        level: 0,
        full: false,
        beat: clickOn ? -4 : null,
      })
    } catch (err) {
      if (mine !== attempt.current) return
      setRecording(null)
      setStatus({
        state: "error",
        message:
          err instanceof MicError ? err.message : "Couldn't start recording.",
      })
    }
  }

  const stopRecording = async (keep: boolean) => {
    const r = recorder.current
    recorder.current = null
    attempt.current++
    setRecording(null)
    if (!r) return
    if (!keep) return r.cancel()
    const take = await r.stop()
    if (take.samples.length < take.sampleRate * 0.25)
      return setStatus({
        state: "error",
        message: "That take was too short. Record for a little longer.",
      })
    void open(takeToFile(take), take.bpm)
  }

  const convert = async (rec: Loaded, sens = sensitivity) => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    player.stop()
    try {
      setStatus({ state: "working", step: "Finding notes", progress: 0 })
      const frames = await analyseFrames(rec.samples, ANALYSIS_RATE, {
        sensitivity: sens,
        signal: ctl.signal,
        onProgress: (p) =>
          setStatus({ state: "working", step: "Finding notes", progress: p }),
      })
      const hop = HOP / ANALYSIS_RATE
      const notes = framesToNotes(frames, hop)
      const detected = rec.bpm ?? estimateTempo(notes, frames, hop)
      setResult({ notes, detected, clicked: rec.bpm !== undefined })
      setBpm(detected)
      setStatus(
        notes.length
          ? { state: "idle" }
          : {
              state: "error",
              message:
                "No notes found. Try a recording of one instrument or voice, or turn up the sensitivity.",
            }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setStatus({
        state: "error",
        message: "Something went wrong finding the notes.",
      })
    }
  }

  const open = async (file: File, clickedBpm?: number) => {
    abort.current?.abort()
    player.stop()
    setResult(null)
    if (!isAudioFile(file))
      return setStatus({
        state: "error",
        message: `${file.name} isn't an audio file. Choose a WAV (or MP3, OGG, FLAC) recording.`,
      })
    if (file.size > MAX_FILE_BYTES)
      return setStatus({
        state: "error",
        message: `${file.name} is ${mb(file.size)}. Files up to ${mb(MAX_FILE_BYTES)} work.`,
      })
    setStatus({ state: "working", step: "Reading the recording", progress: 0 })
    try {
      const { samples, duration } = await decodeAudio(file)
      if (duration > MAX_SECONDS)
        return setStatus({
          state: "error",
          message: `That recording is ${fmt(duration)} long. Recordings up to ${MAX_SECONDS / 60} minutes work.`,
        })
      const rec: Loaded = {
        file,
        url: URL.createObjectURL(file),
        samples,
        duration,
        wave: peaks(samples, WAVE_WIDTH),
        bpm: clickedBpm,
      }
      setLoaded(rec)
      await convert(rec)
    } catch {
      setStatus({
        state: "error",
        message: `Couldn't read ${file.name}. It may be damaged, or in a format this browser can't play.`,
      })
    }
  }

  const openDropped = React.useEffectEvent((file: File) => void open(file))
  React.useEffect(() => {
    if (!dropped) return
    // After mount (and only once under StrictMode, whose first run is cancelled).
    const t = setTimeout(() => openDropped(dropped.file))
    return () => clearTimeout(t)
  }, [dropped])

  const parsed = React.useMemo(
    () => (result ? toParsedMidi(result.notes, bpm) : null),
    [result, bpm]
  )
  const key = React.useMemo(
    () =>
      parsed && result?.notes.length
        ? guessKey(parsed, { audio: "melody" })
        : null,
    [parsed, result]
  )
  const notes = React.useMemo(() => result?.notes ?? [], [result])
  const lowest = notes.length ? Math.min(...notes.map((n) => n.pitch)) : 0
  const highest = notes.length ? Math.max(...notes.map((n) => n.pitch)) : 0
  const name = loaded ? base(loaded.file.name) : ""

  const events = React.useMemo(() => toEvents(notes, bpm), [notes, bpm])
  const end = loaded ? (loaded.duration * bpm) / 60 : 0
  const previewing = player.playing || player.loading
  const togglePreview = () => {
    if (previewing) return player.stop()
    void player.play(
      { events, bpm, end: end + 0.5, loop: false, instruments },
      0
    )
  }

  const download = () => {
    if (!key) return
    const bytes = buildMidi(events, {
      bpm,
      title: name,
      keySig: keySignature(key),
      programs: { melody: 0 },
    })
    downloadBytes(bytes, `${name}.mid`)
  }

  // Seconds on the page, for the playhead.
  const at =
    player.beat !== null && player.playing ? (player.beat * 60) / bpm : null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Audio to MIDI</CardTitle>
          <CardDescription>
            Turn a recording of one melody (singing, humming or a single
            instrument) into MIDI notes, from a file or the microphone. It all
            happens on this device; nothing is uploaded.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input
            ref={inputRef}
            type="file"
            accept=".wav,.wave,.mp3,.ogg,.oga,.flac,.m4a,.aac,.webm,audio/*"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void open(file)
            }}
          />
          {recording !== null ? (
            <RecordingPanel
              state={recording}
              onStop={() => void stopRecording(true)}
              onCancel={() => void stopRecording(false)}
            />
          ) : (
            <div
              className={cn(
                "grid gap-3",
                canRecord() && "sm:grid-cols-[2fr_1fr]"
              )}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) void open(file)
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors outline-none hover:border-primary/60 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
                  over && "border-primary bg-primary/5"
                )}
              >
                <FileAudioIcon className="size-8 text-muted-foreground" />
                <span className="font-medium">
                  {loaded ? "Choose another recording" : "Choose a recording"}
                </span>
                <span className="text-sm text-muted-foreground">
                  Or drop a WAV file here (MP3, OGG and FLAC work too). Up to{" "}
                  {MAX_SECONDS / 60} minutes.
                </span>
              </button>
              {canRecord() && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void record()}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 px-4 py-8 text-center transition-colors outline-none hover:border-primary/60 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
                >
                  <MicIcon className="size-8 text-muted-foreground" />
                  <span className="font-medium">Record</span>
                  <span className="text-sm text-muted-foreground">
                    {clickOn
                      ? `A bar of clicks at ${clickBpm} BPM, then sing, hum or play.`
                      : "Sing, hum or play into the microphone."}
                  </span>
                </button>
              )}
            </div>
          )}

          {recording === null && canRecord() && (
            <div className="flex flex-col gap-3 rounded-xl border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="record-click">Click while recording</Label>
                  <p
                    id="record-click-help"
                    className="text-sm text-muted-foreground"
                  >
                    A bar of count-in, then a click on every beat. Your notes
                    land on the bars at this tempo, ready to arrange. Use
                    headphones so the click isn't recorded.
                  </p>
                </div>
                <Switch
                  id="record-click"
                  aria-describedby="record-click-help"
                  checked={clickOn}
                  onCheckedChange={(on) => changeClick({ on })}
                  disabled={busy}
                />
              </div>
              {clickOn && (
                <TempoControl
                  id="record-bpm"
                  label="Click tempo"
                  bpm={clickBpm}
                  onChange={(bpm) => changeClick({ bpm })}
                />
              )}
            </div>
          )}

          {loaded && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="min-w-0 truncate font-medium">
                  {loaded.file.name}
                </span>
                <span className="text-muted-foreground">
                  {fmt(loaded.duration)} · {mb(loaded.file.size)}
                </span>
              </div>
              <Picture
                wave={loaded.wave}
                notes={notes}
                duration={loaded.duration}
                at={at}
                bar={loaded.bpm ? (4 * 60) / loaded.bpm : undefined}
              />
              <audio
                controls
                src={loaded.url}
                className="h-10 w-full"
                aria-label="The original recording"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="sensitivity">Sensitivity</Label>
              <span className="text-xs text-muted-foreground">
                {sensitivity < 0.34
                  ? "Only clear notes"
                  : sensitivity > 0.66
                    ? "Quieter notes too"
                    : "Balanced"}
              </span>
            </div>
            <Slider
              id="sensitivity"
              aria-label="Sensitivity"
              min={0}
              max={1}
              step={0.05}
              value={[sensitivity]}
              onValueChange={([v]) => setSensitivity(v)}
              disabled={busy}
            />
            {loaded && (
              <Button
                variant="outline"
                className="self-start"
                disabled={busy}
                onClick={() => void convert(loaded)}
              >
                <WandSparklesIcon /> Find notes again
              </Button>
            )}
          </div>

          <div aria-live="polite" className="contents">
            {status.state === "working" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" />
                  {status.step}…
                </div>
                <div
                  role="progressbar"
                  aria-label={status.step}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(status.progress * 100)}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${status.progress * 100}%` }}
                  />
                </div>
              </div>
            )}
            {status.state === "error" && (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive-strong" />
                {status.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {result && notes.length > 0 && key && parsed && loaded && (
        <Card>
          <CardHeader>
            <CardTitle>
              {notes.length} {notes.length === 1 ? "note" : "notes"} found
            </CardTitle>
            <CardDescription>
              Check the tempo before you download: the notes are placed on bars
              at this speed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Key", keyLabel(key)],
                result.clicked
                  ? ["Tempo (click)", `${result.detected} BPM`]
                  : ["Tempo found", `${result.detected} BPM`],
                [
                  "Range",
                  `${noteNameWithOctave(lowest, key)} – ${noteNameWithOctave(highest, key)}`,
                ],
                ["Length", fmt(loaded.duration)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <TempoControl bpm={bpm} onChange={(v) => setBpm(v)} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant={previewing ? "destructive" : "default"}
                onClick={togglePreview}
              >
                {player.loading ? (
                  <Loader2Icon className="animate-spin" />
                ) : previewing ? (
                  <SquareIcon />
                ) : (
                  <PlayIcon />
                )}
                {player.loading
                  ? "Loading"
                  : previewing
                    ? "Stop"
                    : "Play the notes"}
              </Button>
              <Button variant="outline" onClick={download}>
                <DownloadIcon /> Download MIDI
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  player.stop()
                  onOpenAsSong(parsed, `${name}.mid`)
                }}
              >
                <SquarePenIcon /> Make an arrangement
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Make an arrangement opens the tune as a new song, with chords
              worked out to fit it and a bass line and drums, ready to edit and
              export as MIDI.
            </p>
          </CardContent>
        </Card>
      )}

      {!loaded && status.state !== "working" && (
        <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <AudioLinesIcon className="size-4" />
          Works best with one voice or instrument at a time, with little
          background noise.
        </p>
      )}
    </div>
  )
}

/** The recording's waveform, with the notes found drawn over it. */
function Picture({
  wave,
  notes,
  duration,
  at,
  bar,
}: {
  wave: Float32Array
  notes: FoundNote[]
  duration: number
  at: number | null
  /** Bar length in seconds, for a take recorded to a click. */
  bar?: number
}) {
  const H = 120
  const top = Math.max(...wave, 0.001)
  let d = ""
  wave.forEach((v, x) => {
    const h = (v / top) * (H / 2 - 4)
    d += `M${x + 0.5} ${H / 2 - h}V${H / 2 + h}`
  })
  const lo = Math.min(...notes.map((n) => n.pitch)) - 2
  const hi = Math.max(...notes.map((n) => n.pitch)) + 2
  const row = notes.length ? (H - 8) / Math.max(12, hi - lo) : 0
  const x = (s: number) => (s / duration) * WAVE_WIDTH
  return (
    <svg
      viewBox={`0 0 ${WAVE_WIDTH} ${H}`}
      preserveAspectRatio="none"
      className="h-28 w-full rounded-lg border bg-muted/30"
      role="img"
      aria-label={
        notes.length
          ? `Waveform of the recording, with the ${notes.length} notes found`
          : "Waveform of the recording"
      }
    >
      <path d={d} className="stroke-muted-foreground/40" strokeWidth={1} />
      {bar &&
        Array.from({ length: Math.floor(duration / bar) }, (_, i) => (
          <line
            key={i}
            x1={x((i + 1) * bar)}
            x2={x((i + 1) * bar)}
            y1={0}
            y2={H}
            className="stroke-foreground/50"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {notes.map((n, i) => (
        <rect
          key={i}
          x={x(n.start)}
          width={Math.max(1.5, x(n.end) - x(n.start))}
          y={H - 4 - (n.pitch - lo + 1) * row}
          height={Math.max(2, row * 0.8)}
          rx={1}
          className="fill-primary"
        />
      ))}
      {at !== null && at <= duration && (
        <line
          x1={x(at)}
          x2={x(at)}
          y1={0}
          y2={H}
          className="stroke-foreground"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

/** Shown while recording: how long, how loud, and Stop. */
function RecordingPanel({
  state,
  onStop,
  onCancel,
}: {
  state: "starting" | RecordingState
  onStop: () => void
  onCancel: () => void
}) {
  const starting = state === "starting"
  const level = starting ? 0 : state.level
  // A log scale, so quiet singing still moves the meter: -48 dB to 0 dB.
  const meter = level > 0 ? Math.max(0, 1 + Math.log10(level) / 2.4) : 0
  const beat = starting ? null : state.beat
  // In the count-in: the beats still to come (4, 3, 2, 1).
  const counting = beat !== null && beat < 0 ? Math.ceil(-beat) : null
  return (
    <div className="flex flex-col gap-4 rounded-xl border-2 border-destructive/50 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium" role="status">
          {starting ? (
            <>
              <Loader2Icon className="size-4 animate-spin" />
              Waiting for the microphone…
            </>
          ) : counting !== null ? (
            <>
              <span className="size-3 rounded-full border-2 border-destructive" />
              Count-in… {counting}
            </>
          ) : (
            <>
              <span className="size-3 rounded-full bg-destructive motion-safe:animate-pulse" />
              Recording
            </>
          )}
        </span>
        {!starting && (
          <span className="font-mono text-lg tabular-nums" aria-hidden>
            {fmt(state.seconds)}
          </span>
        )}
      </div>
      {beat !== null && (
        <div className="flex items-center gap-3" aria-hidden>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((b) => (
              <span
                key={b}
                className={cn(
                  "size-4 rounded-full border-2",
                  ((Math.floor(beat) % 4) + 4) % 4 === b
                    ? counting !== null
                      ? "border-foreground bg-foreground"
                      : "border-primary bg-primary"
                    : "border-muted-foreground/40"
                )}
              />
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
            {counting !== null
              ? "Starts on the next 1"
              : `Bar ${Math.floor(beat / 4) + 1}`}
          </span>
        </div>
      )}
      <div
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(meter * 100)}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full transition-[width] duration-75",
            level > 0.98 ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${meter * 100}%` }}
        />
      </div>
      {!starting && state.full && (
        <p className="text-sm text-muted-foreground">
          That's the longest a take can be ({MAX_RECORDING / 60} minutes). Stop
          to find its notes.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" onClick={onStop} disabled={starting}>
          <SquareIcon /> Stop and find notes
        </Button>
        <Button variant="outline" onClick={onCancel}>
          <XIcon /> Cancel
        </Button>
      </div>
    </div>
  )
}
