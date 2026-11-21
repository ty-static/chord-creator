import * as React from "react"
import {
  CpuIcon,
  DownloadIcon,
  Loader2Icon,
  PlayIcon,
  SplitIcon,
  SquareIcon,
  SquarePenIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react"

import type { Player } from "@/components/audio-to-midi"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SNAPS,
  type Snap,
  type FoundNote,
  snapNotes,
} from "@/lib/audio-to-midi"
import type { TrackInstruments } from "@/lib/instruments"
import { buildMidi, downloadBytes } from "@/lib/midi"
import {
  MAX_IMPORT_BARS,
  type ParsedMidi,
  guessKey,
  guessRoles,
} from "@/lib/midi-import"
import { keyLabel, keySignature } from "@/lib/music"
import {
  MODEL_MB,
  ENV_HOP,
  STEMS,
  STEM_RATE,
  type Stem,
  type StemId,
  type StemsProgress,
  alignToBeat,
  beatOffset,
  canSplit,
  decodeStereo,
  modelSaved,
  snapParts,
  songTempo,
  splitSong,
  stemsToEvents,
  stemsToParsedMidi,
} from "@/lib/stems"
import { encodeWav } from "@/lib/wav"

interface Props {
  file: File
  duration: number
  player: Player
  instruments: TrackInstruments
  onOpenAsSong: (midi: ParsedMidi, filename: string) => void
}

type Status =
  | { state: "idle" }
  | { state: "working"; progress: StemsProgress | null; gpu: boolean | null }
  | { state: "error"; message: string }

interface Done {
  stems: Stem[]
  /** Audio of each stem, as a WAV object URL. */
  urls: Record<StemId, string>
  detected: number
  /** Onset strength (for placing the beat at any tempo). */
  env: Float32Array
}

const base = (name: string) => name.replace(/\.[^.]+$/, "")
const MB = 1024 * 1024

function describe(p: StemsProgress | null) {
  if (!p) return { step: "Getting ready", progress: 0 }
  if (p.step === "download")
    return {
      step: `Downloading the instrument splitter (${Math.round(p.loaded / MB)} of ${Math.round(p.total / MB)} MB)`,
      progress: p.loaded / p.total,
    }
  if (p.step === "split")
    return { step: "Splitting into instruments", progress: p.progress }
  const label = STEMS.find((s) => s.id === p.stem)!.label
  return { step: `Finding notes: ${label}`, progress: p.progress }
}

export function SongToMidi({
  file,
  duration,
  player,
  instruments,
  onOpenAsSong,
}: Props) {
  const [status, setStatus] = React.useState<Status>({ state: "idle" })
  const [done, setDone] = React.useState<Done | null>(null)
  const [saved, setSaved] = React.useState(false)
  const [bpm, setBpm] = React.useState(120)
  const [snap, setSnap] = React.useState<Snap>("off")
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    void modelSaved().then(setSaved)
    return () => abort.current?.abort()
  }, [])
  React.useEffect(() => {
    if (!done) return
    return () => Object.values(done.urls).forEach((u) => URL.revokeObjectURL(u))
  }, [done])

  const run = async () => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    player.stop()
    setDone(null)
    setStatus({ state: "working", progress: null, gpu: null })
    try {
      const song = await decodeStereo(file)
      const stems = await splitSong(song, {
        signal: ctl.signal,
        onProgress: (progress) =>
          setStatus((s) => (s.state === "working" ? { ...s, progress } : s)),
        onBackend: (gpu) =>
          setStatus((s) => (s.state === "working" ? { ...s, gpu } : s)),
      })
      const tempo = songTempo(stems, duration)
      const urls = Object.fromEntries(
        stems.map((s) => [
          s.id,
          URL.createObjectURL(
            new Blob([encodeWav([s.audio], STEM_RATE)], { type: "audio/wav" })
          ),
        ])
      ) as Record<StemId, string>
      setDone({ stems, urls, detected: tempo.bpm, env: tempo.env })
      setBpm(tempo.bpm)
      setSaved(true)
      setStatus(
        stems.some((s) => s.notes.length)
          ? { state: "idle" }
          : {
              state: "error",
              message: "No notes found in any of the instruments.",
            }
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setStatus({
        state: "error",
        message:
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong splitting the song.",
      })
    }
  }

  const cancel = () => {
    abort.current?.abort()
    setStatus({ state: "idle" })
  }

  // The notes on the beat at the chosen tempo, then snapped if asked.
  const parts = React.useMemo(() => {
    if (!done) return []
    const offset = beatOffset(done.env, ENV_HOP, bpm)
    return done.stems.map((s) => {
      const aligned = alignToBeat(s.notes, bpm, offset)
      const notes: FoundNote[] =
        s.id === "vocals"
          ? snapNotes(aligned, bpm, snap)
          : snapParts(aligned, bpm, snap)
      return { id: s.id, notes }
    })
  }, [done, bpm, snap])
  const parsed = React.useMemo(
    () => (parts.length ? stemsToParsedMidi(parts, bpm) : null),
    [parts, bpm]
  )
  const key = React.useMemo(() => {
    if (!parsed) return null
    return guessKey(parsed, guessRoles(parsed.parts))
  }, [parsed])

  const events = React.useMemo(() => stemsToEvents(parts, bpm), [parts, bpm])
  const end = (duration * bpm) / 60 + 4
  const previewing = player.playing || player.loading
  const name = base(file.name)

  const togglePreview = () => {
    if (previewing) return player.stop()
    void player.play({ events, bpm, end, loop: false, instruments }, 0)
  }

  const download = (only?: StemId) => {
    if (!key) return
    const info = only ? STEMS.find((s) => s.id === only)! : null
    const bytes = buildMidi(
      only ? events.filter((e) => e.track === info!.track) : events,
      {
        bpm,
        title: info ? `${name} (${info.label})` : name,
        keySig: keySignature(key),
        programs: { melody: 0, chords: 0 },
        names: Object.fromEntries(STEMS.map((s) => [s.track, s.label])),
      }
    )
    downloadBytes(
      bytes,
      info ? `${name} - ${info.label.replace(/&/g, "and")}.mid` : `${name}.mid`
    )
  }

  const working = status.state === "working"
  const shown = working ? describe(status.progress) : null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Split into instruments</CardTitle>
          <CardDescription>
            An AI model separates the vocals, bass, drums and everything else
            (guitars, keys…), then each one&apos;s notes are found and written
            as its own MIDI track. It all happens on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!canSplit() ? (
            <p className="text-sm text-muted-foreground">
              This browser can&apos;t run the instrument splitter. Try a recent
              Chrome, Edge, Firefox or Safari.
            </p>
          ) : working ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <div className="flex items-center gap-2 text-sm">
                <Loader2Icon className="size-4 animate-spin" />
                {shown!.step}…
              </div>
              <div
                role="progressbar"
                aria-label={shown!.step}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(shown!.progress * 100)}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${shown!.progress * 100}%` }}
                />
              </div>
              {status.gpu !== null && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {status.gpu ? (
                    <>
                      <ZapIcon className="size-3.5" /> Using the graphics card.
                    </>
                  ) : (
                    <>
                      <CpuIcon className="size-3.5" /> No graphics card support
                      in this browser, so this runs on the processor and can
                      take a long time (several minutes a minute of music).
                    </>
                  )}
                </p>
              )}
              <Button variant="outline" className="self-start" onClick={cancel}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button className="self-start" onClick={() => void run()}>
                <SplitIcon /> {done ? "Split again" : "Split into instruments"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {saved
                  ? "The splitter is saved on this device."
                  : `The first time, the splitter (about ${MODEL_MB} MB) is downloaded and kept on this device.`}{" "}
                A song takes a few minutes, quickest in a browser that can use
                the graphics card (Chrome or Edge).
              </p>
            </div>
          )}
          {status.state === "error" && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive-strong" />
              {status.message}
            </p>
          )}
        </CardContent>
      </Card>

      {done && parsed && key && (
        <Card>
          <CardHeader>
            <CardTitle>Instruments found</CardTitle>
            <CardDescription>
              Listen to each part on its own, then download its notes. Check the
              tempo first: the notes are placed on bars at this speed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-2">
              {[
                ["Key", keyLabel(key)],
                ["Tempo found", `${done.detected} BPM`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <TempoControl id="song-bpm" bpm={bpm} onChange={(v) => setBpm(v)} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="song-snap">Snap to the beat</Label>
              <Select value={snap} onValueChange={(v) => setSnap(v as Snap)}>
                <SelectTrigger id="song-snap" className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SNAPS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ul className="divide-y rounded-lg border">
              {STEMS.map((info) => {
                const notes = parts.find((p) => p.id === info.id)?.notes ?? []
                return (
                  <li
                    key={info.id}
                    className="flex flex-col gap-2 px-3 py-3"
                    data-stem={info.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{info.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {notes.length}{" "}
                          {info.id === "drums"
                            ? notes.length === 1
                              ? "hit"
                              : "hits (kick, snare, hi-hat)"
                            : notes.length === 1
                              ? "note"
                              : "notes"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!notes.length}
                        onClick={() => download(info.id)}
                        aria-label={`Download the ${info.label} MIDI`}
                      >
                        <DownloadIcon /> MIDI
                      </Button>
                    </div>
                    <audio
                      controls
                      src={done.urls[info.id]}
                      className="h-9 w-full"
                      aria-label={`${info.label}, separated`}
                    />
                  </li>
                )
              })}
            </ul>

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
                    : "Play the MIDI"}
              </Button>
              <Button variant="outline" onClick={() => download()}>
                <DownloadIcon /> Download all (one MIDI file)
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
              The MIDI file has a track for each instrument. Make an arrangement
              opens the parts as a new song in the editor (the first{" "}
              {MAX_IMPORT_BARS} bars).
            </p>
          </CardContent>
        </Card>
      )}
    </>
  )
}
