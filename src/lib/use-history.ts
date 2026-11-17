import * as React from "react"

const LIMIT = 200
const COALESCE_MS = 600

interface State<T> {
  past: T[]
  present: T
  future: T[]
  lastKey: string | null
  lastTime: number
}

export interface SetOptions {
  /**
   * Rapid changes sharing the same key (e.g. dragging the tempo slider)
   * are merged into a single undo step.
   */
  coalesce?: string
}

/** State with an undo/redo stack. */
export function useHistory<T>(init: () => T) {
  const [state, setState] = React.useState<State<T>>(() => ({
    past: [],
    present: init(),
    future: [],
    lastKey: null,
    lastTime: 0,
  }))

  const set = React.useCallback(
    (update: T | ((prev: T) => T), opts: SetOptions = {}) => {
      setState((s) => {
        const next =
          typeof update === "function"
            ? (update as (prev: T) => T)(s.present)
            : update
        if (Object.is(next, s.present)) return s
        const now = Date.now()
        const merge =
          opts.coalesce != null &&
          opts.coalesce === s.lastKey &&
          now - s.lastTime < COALESCE_MS
        return {
          past: merge ? s.past : [...s.past, s.present].slice(-LIMIT),
          present: next,
          future: [],
          lastKey: opts.coalesce ?? null,
          lastTime: now,
        }
      })
    },
    []
  )

  const undo = React.useCallback(() => {
    setState((s) => {
      if (!s.past.length) return s
      return {
        past: s.past.slice(0, -1),
        present: s.past[s.past.length - 1],
        future: [s.present, ...s.future],
        lastKey: null,
        lastTime: 0,
      }
    })
  }, [])

  const redo = React.useCallback(() => {
    setState((s) => {
      if (!s.future.length) return s
      return {
        past: [...s.past, s.present],
        present: s.future[0],
        future: s.future.slice(1),
        lastKey: null,
        lastTime: 0,
      }
    })
  }, [])

  return {
    value: state.present,
    set,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return (
    !!el &&
    (el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  )
}

/** Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. */
export function useUndoShortcuts(undo: () => void, redo: () => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditable(e.target)) return
      const k = e.key.toLowerCase()
      if (k === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo, redo])
}
