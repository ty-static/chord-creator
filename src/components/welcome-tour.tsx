import * as React from "react"
import {
  DownloadIcon,
  LibraryIcon,
  ListMusicIcon,
  MusicIcon,
  PianoIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const STEPS: {
  icon: React.ElementType
  title: string
  body: React.ReactNode
}[] = [
  {
    icon: MusicIcon,
    title: "Welcome to Static Sound",
    body: "Write chord progressions and melodies, hear them with real instruments, and download a MIDI file you can drop into any DAW. Here's a 30-second tour.",
  },
  {
    icon: PianoIcon,
    title: "1. Pick a key",
    body: (
      <>
        Choose a <b>key</b> and <b>scale</b> in the Key &amp; Tempo panel. Every
        chord and melody note follows it, so you can change key at any time and
        everything moves with it.
      </>
    ),
  },
  {
    icon: ListMusicIcon,
    title: "2. Build your chords",
    body: (
      <>
        Click the chords that belong to your key to add them, load a{" "}
        <b>preset</b>, or hit <b>Randomize</b>. Change each chord&apos;s type
        and length on its card, and drag the <b>⋮⋮</b> handle to reorder.
      </>
    ),
  },
  {
    icon: SparklesIcon,
    title: "3. Write a melody",
    body: (
      <>
        On the <b>Melody</b> tab, press <b>Generate</b> for a melody that fits
        your chords. Then click or drag on the grid to draw notes, drag them to
        move or resize, and use the arrow keys to nudge a selected note.
      </>
    ),
  },
  {
    icon: PlayIcon,
    title: "4. Listen and loop",
    body: (
      <>
        Press <b>Space</b> or <b>Play</b>. Click a bar on the timeline to start
        there, or drag across bars to loop a section. Pick instruments and
        balance the tracks in the <b>Sound</b> panel. Add a beat on the{" "}
        <b>Drums</b> tab.
      </>
    ),
  },
  {
    icon: DownloadIcon,
    title: "5. Export to MIDI",
    body: (
      <>
        Hit <b>Download MIDI</b> for a file with separate chord, melody, bass
        and drum tracks, ready for your DAW. You can also <b>Import</b> a MIDI
        file, or play in from a <b>MIDI keyboard</b>. Made a mistake?{" "}
        <b>Ctrl+Z</b> undoes anything.
      </>
    ),
  },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTryExample: () => void
}

export function WelcomeTour({ open, onOpenChange, onTryExample }: Props) {
  const [step, setStep] = React.useState(0)
  const last = step === STEPS.length - 1
  const { icon: Icon, title, body } = STEPS[step]

  const close = () => {
    onOpenChange(false)
    setStep(0)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Icon className="size-6" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="min-h-24 text-balance">
            {body}
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex justify-center gap-1.5"
          aria-label={`Step ${step + 1} of ${STEPS.length}`}
        >
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={`Go to step ${i + 1}`}
              onClick={() => setStep(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step
                  ? "w-6 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
              )}
            />
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {step === 0 ? (
            <Button variant="ghost" onClick={close}>
              Skip
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => {
                  onTryExample()
                  close()
                }}
              >
                <LibraryIcon /> Try an example
              </Button>
              <Button onClick={close}>Start creating</Button>
            </div>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)}>
              {step === 0 ? "Show me" : "Next"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
