import * as React from "react"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FilePlusIcon,
  FolderOpenIcon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TitleInput } from "@/components/song-title"
import type { LibraryEntry } from "@/lib/library"
import { cn } from "@/lib/utils"

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
function edited(time: number, now: number) {
  const s = Math.round((time - now) / 1000)
  if (s > -45) return "just now"
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
  ]
  for (let i = steps.length - 1; i >= 0; i--) {
    const [unit, size] = steps[i]
    if (-s >= size || unit === "minute")
      return ago.format(Math.round(s / size), unit)
  }
  return ""
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: LibraryEntry[]
  /** When the list was read, for "edited 5 minutes ago". */
  now: number
  currentId: string
  onOpen: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDuplicate: (id: string) => void
  onDownload: (id: string) => void
  onDelete: (id: string) => void
  onBackup: () => void
  onImport: () => void
}

export function SongLibrary({
  open,
  onOpenChange,
  entries,
  now,
  currentId,
  onOpen,
  onNew,
  onRename,
  onDuplicate,
  onDownload,
  onDelete,
  onBackup,
  onImport,
}: Props) {
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setRenaming(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpenIcon className="size-5" /> My songs
          </DialogTitle>
          <DialogDescription>
            Saved in this browser as you work. Download a backup to keep them
            safe or move them to another device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onNew}>
            <FilePlusIcon /> New song
          </Button>
          <Button size="sm" variant="outline" onClick={onImport}>
            <UploadIcon /> Open file
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onBackup}
            disabled={!entries.length}
          >
            <DownloadIcon /> Back up all
          </Button>
        </div>
        <ul
          className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1"
          aria-label="Songs"
        >
          {entries.map((e) => {
            const current = e.id === currentId
            return (
              <li
                key={e.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2 pl-3",
                  current && "border-primary/50 bg-primary/5"
                )}
              >
                {renaming === e.id ? (
                  <TitleInput
                    initial={e.title}
                    onDone={(title) => {
                      setRenaming(null)
                      if (title && title !== e.title) onRename(e.id, title)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start text-left outline-none focus-visible:underline"
                    onClick={() =>
                      current ? onOpenChange(false) : onOpen(e.id)
                    }
                    aria-current={current || undefined}
                  >
                    <span className="flex w-full items-center gap-1.5 font-medium">
                      <span className="truncate">{e.title}</span>
                      {current && (
                        <span className="shrink-0 rounded bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground uppercase">
                          Open
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {e.summary} · {edited(e.updated, now)}
                    </span>
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${e.title} options`}
                    >
                      <EllipsisIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => setRenaming(e.id)}>
                      <PencilIcon /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDuplicate(e.id)}>
                      <CopyIcon /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDownload(e.id)}>
                      <DownloadIcon /> Download song file
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDelete(e.id)}
                    >
                      <Trash2Icon /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/** Shown when the clipboard isn't available: the link, ready to copy by hand. */
export function ShareLinkDialog({
  url,
  onClose,
}: {
  url: string | null
  onClose: () => void
}) {
  const [copied, setCopied] = React.useState(false)
  const [prev, setPrev] = React.useState(url)
  if (url !== prev) {
    setPrev(url)
    setCopied(false)
  }
  return (
    <Dialog open={!!url} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share link</DialogTitle>
          <DialogDescription>
            The whole song is inside this link — anyone who opens it gets their
            own copy to play and edit.
          </DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          value={url ?? ""}
          aria-label="Share link"
          rows={4}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full resize-none rounded-md border bg-muted/50 p-2 font-mono text-xs break-all outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url ?? "")
                setCopied(true)
              } catch {
                setCopied(false)
              }
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
