import * as React from "react"
import {
  AudioLinesIcon,
  DownloadIcon,
  FileAudioIcon,
  Loader2Icon,
  PlayIcon,
  SquareIcon,
  SquarePenIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
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
}

interface Result {
  notes: FoundNote[]
  /** The tempo guessed from the recording. */
  detected: number
}

type Status =
  | { state: "idle" }
  | { state: "working"; step: string; progress: number }
  | { state: "error"; message: string }

const WAVE_WIDTH = 600
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
  const [status, setStatus] = React.useState<Status>({ state: "idle" })
  const [over, setOver] = React.useState(false)
  const abort = React.useRef<AbortController | null>(null)
  const working = status.state === "working"

  // Forget the recording's object URL when it's replaced or the page goes.
  React.useEffect(() => {
    if (loaded) return () => URL.revokeObjectURL(loaded.url)
  }, [loaded])
  React.useEffect(() => () => abort.current?.abort(), [])

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
      const detected = estimateTempo(notes, frames, hop)
      setResult({ notes, detected })
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

  const open = async (file: File) => {
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
            instrument) into MIDI notes. It all happens on this device; nothing
            is uploaded.
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
          <button
            type="button"
            disabled={working}
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
              disabled={working}
            />
            {loaded && (
              <Button
                variant="outline"
                className="self-start"
                disabled={working}
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
                ["Tempo found", `${result.detected} BPM`],
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
                <SquarePenIcon /> Open as a song
              </Button>
            </div>
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
}: {
  wave: Float32Array
  notes: FoundNote[]
  duration: number
  at: number | null
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
