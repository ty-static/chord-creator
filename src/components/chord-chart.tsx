import * as React from "react"
import { createPortal } from "react-dom"
import { CheckIcon, CopyIcon, PrinterIcon } from "lucide-react"

import type { Song } from "@/lib/arrange"
import {
  BARS_PER_LINE,
  type Chart,
  chartKey,
  chartText,
  chordChart,
  formLine,
} from "@/lib/chart"
import { keyLabel } from "@/lib/music"
import { MAX_TRANSPOSE } from "@/lib/arrange"
import { cn } from "@/lib/utils"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const TRANSPOSES = Array.from(
  { length: MAX_TRANSPOSE * 2 + 1 },
  (_, i) => i - MAX_TRANSPOSE
).filter((t) => t !== 0)

/** The chart itself: on screen in the dialog, and on paper. */
function ChartView({ chart, print }: { chart: Chart; print?: boolean }) {
  const muted = print ? "text-neutral-600" : "text-muted-foreground"
  return (
    <article
      aria-label="Chord chart"
      className={cn("flex flex-col gap-4", print && "text-black")}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{chart.title}</h2>
        <p className={cn("text-sm", muted)}>
          {chart.key} · {chart.bpm} BPM · {chart.meter}
        </p>
        <p className="text-sm">
          <span className={muted}>Form: </span>
          {formLine(chart.form)}
        </p>
      </header>
      {chart.sections.map((s) => (
        <section
          key={s.letter}
          aria-label={`${s.letter} ${s.name}`}
          className="flex break-inside-avoid flex-col gap-1.5"
        >
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded text-xs",
                print
                  ? "border border-black"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {s.letter}
            </span>
            {s.name}
            {s.notes.length > 0 && (
              <span className={cn("text-xs font-normal italic", muted)}>
                {s.notes.join(" · ")}
              </span>
            )}
          </h3>
          <div
            className={cn(
              "grid border-r",
              print ? "border-black" : "border-foreground/40"
            )}
            style={{
              gridTemplateColumns: `repeat(${BARS_PER_LINE}, minmax(0, 1fr))`,
            }}
          >
            {s.bars.map((bar, i) => (
              <div
                key={i}
                aria-label={`Bar ${i + 1}`}
                className={cn(
                  "flex min-h-10 items-center border-l px-2 font-medium",
                  print && "min-h-12 text-lg",
                  print ? "border-black" : "border-foreground/40"
                )}
              >
                {bar.length ? (
                  bar.map((c, j) => (
                    <span
                      key={j}
                      className="min-w-0 truncate"
                      title={c.name}
                      style={{ flex: `${c.beats} 1 0` }}
                    >
                      {c.name}
                    </span>
                  ))
                ) : (
                  <span className={muted} aria-label="Same chord">
                    %
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      {chart.ending && (
        <p className="text-sm">
          <span className={muted}>Ending: </span>
          {chart.ending}
        </p>
      )}
    </article>
  )
}

export function ChordChartDialog({
  open,
  onOpenChange,
  song,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  song: Song
}) {
  const [numerals, setNumerals] = React.useState(false)
  const [transpose, setTranspose] = React.useState(0)
  const [copied, setCopied] = React.useState(false)
  const chart = React.useMemo(
    () => chordChart(song, { numerals, transpose }),
    [song, numerals, transpose]
  )

  // Printing shows only the chart, named after the song (the file name when
  // saving as PDF).
  const print = () => {
    const title = document.title
    document.title = chart.title
    window.addEventListener("afterprint", () => (document.title = title), {
      once: true,
    })
    window.print()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chartText(chart))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Chord chart</DialogTitle>
          <DialogDescription>
            Every section&apos;s chords, bar by bar, to play from. A % means the
            chord before it carries on.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={numerals ? "numerals" : "names"}
            onValueChange={(v) => v && setNumerals(v === "numerals")}
            aria-label="Write chords as"
          >
            <ToggleGroupItem value="names">Chord names</ToggleGroupItem>
            <ToggleGroupItem value="numerals">Numerals</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <Label htmlFor="chart-transpose" className="text-sm">
              Key
            </Label>
            <Select
              value={String(transpose)}
              onValueChange={(v) => setTranspose(Number(v))}
              disabled={numerals}
            >
              <SelectTrigger id="chart-transpose" size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">
                  {keyLabel(song.key)} (as written)
                </SelectItem>
                {TRANSPOSES.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {keyLabel(chartKey(song.key, t))} (
                    {t > 0 ? `+${t}` : `−${-t}`})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-4">
          <ChartView chart={chart} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy as text"}
          </Button>
          <Button onClick={print}>
            <PrinterIcon /> Print or save PDF
          </Button>
        </DialogFooter>
      </DialogContent>
      {open &&
        createPortal(
          <div id="print-chart" aria-hidden>
            <ChartView chart={chart} print />
          </div>,
          document.body
        )}
    </Dialog>
  )
}
