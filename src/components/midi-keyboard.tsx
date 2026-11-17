import * as React from "react"
import { Loader2Icon, PianoIcon, PlugIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { midiInput } from "@/lib/midi-input"
import { cn } from "@/lib/utils"

export function useMidiStatus() {
  return React.useSyncExternalStore(
    midiInput.subscribeStatus,
    () => midiInput.status
  )
}

interface MenuProps {
  playThrough: boolean
  onPlayThrough: (on: boolean) => void
}

/** Header button: connect a MIDI keyboard and see its status. */
export function MidiKeyboardMenu({ playThrough, onPlayThrough }: MenuProps) {
  const { state, devices } = useMidiStatus()
  const live = state === "ready" && devices.length > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative max-sm:size-9 max-sm:px-0"
          aria-label="MIDI keyboard"
        >
          <PianoIcon />
          <span className="hidden sm:inline">MIDI</span>
          {live && (
            <span
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-emerald-500"
              aria-hidden
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>MIDI keyboard</DropdownMenuLabel>
        {state === "unsupported" && (
          <Note>
            This browser can&apos;t use MIDI keyboards. Try Chrome or Edge on a
            computer.
          </Note>
        )}
        {state === "idle" && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              void midiInput.connect()
            }}
          >
            <PlugIcon /> Connect a keyboard
          </DropdownMenuItem>
        )}
        {state === "pending" && (
          <Note>
            <Loader2Icon className="mr-1 inline size-3 animate-spin" />
            Waiting for permission…
          </Note>
        )}
        {state === "denied" && (
          <Note>
            MIDI access was blocked. Allow it in the site settings, then reload
            the page.
          </Note>
        )}
        {state === "ready" &&
          (devices.length ? (
            devices.map((d) => (
              <Note key={d}>
                <span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-500" />
                {d}
              </Note>
            ))
          ) : (
            <Note>No keyboard found. Plug one in — it appears here.</Note>
          ))}
        {state !== "unsupported" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={playThrough}
              onCheckedChange={(v) => onPlayThrough(v === true)}
              onSelect={(e) => e.preventDefault()}
            >
              Hear what you play
            </DropdownMenuCheckboxItem>
            <Note className="text-muted-foreground">
              On the <b>Chords</b> tab, play a chord and let go to add it. On
              the <b>Melody</b> tab, turn on step input and play notes one by
              one.
            </Note>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Note({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <p className={cn("px-2 py-1.5 text-xs", className)}>{children}</p>
}

interface BarProps {
  label: string
  hint: string
  active: boolean
  onToggle: (on: boolean) => void
  children?: React.ReactNode
}

/** Slim bar above an editor to turn keyboard recording on/off. */
export function KeyboardInputBar({
  label,
  hint,
  active,
  onToggle,
  children,
}: BarProps) {
  const { state, devices } = useMidiStatus()
  const id = React.useId()
  if (state === "unsupported") return null
  return (
    <div
      className={cn(
        "mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
        active && "border-primary/50 bg-primary/5"
      )}
    >
      <PianoIcon className="size-4 text-muted-foreground" />
      {state === "ready" ? (
        <>
          <label htmlFor={id} className="font-medium">
            {label}
          </label>
          <Switch id={id} checked={active} onCheckedChange={onToggle} />
          <span className="text-xs text-muted-foreground">
            {devices.length ? hint : "No keyboard connected."}
          </span>
          {active && children}
        </>
      ) : (
        <>
          <span className="text-xs text-muted-foreground">
            Have a MIDI keyboard? Connect it to play and record notes.
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={state === "pending"}
            onClick={() => void midiInput.connect()}
          >
            {state === "pending" ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <PlugIcon />
            )}
            {state === "denied" ? "Blocked — check site settings" : "Connect"}
          </Button>
        </>
      )}
    </div>
  )
}
