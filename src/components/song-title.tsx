import * as React from "react"
import { PencilIcon } from "lucide-react"

import { MAX_TITLE } from "@/lib/song-file"
import { cn } from "@/lib/utils"

/** A text box for a song title: Enter or leaving it saves, Escape cancels. */
export function TitleInput({
  initial,
  onDone,
  className,
}: {
  initial: string
  onDone: (title: string | null) => void
  className?: string
}) {
  const [value, setValue] = React.useState(initial)
  const done = React.useRef(false)
  const finish = (title: string | null) => {
    if (done.current) return
    done.current = true
    onDone(title)
  }
  return (
    <input
      autoFocus
      aria-label="Song title"
      maxLength={MAX_TITLE}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value.trim() || null)
        if (e.key === "Escape") {
          e.stopPropagation()
          finish(null)
        }
      }}
      className={cn(
        "h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    />
  )
}

/** The open song's title in the header; click to rename. */
export function SongTitle({
  title,
  onRename,
}: {
  title: string
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  if (editing)
    return (
      <TitleInput
        initial={title}
        className="h-7 w-full max-w-64 font-heading font-semibold"
        onDone={(t) => {
          setEditing(false)
          if (t && t !== title) onRename(t)
        }}
      />
    )
  return (
    <button
      type="button"
      title="Rename this song"
      onClick={() => setEditing(true)}
      className="group flex max-w-full items-center gap-1.5 rounded text-left font-heading text-base leading-tight font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-lg"
    >
      <span className="truncate">{title}</span>
      <PencilIcon className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
    </button>
  )
}
