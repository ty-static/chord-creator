import { describe, expect, it } from "vitest"

import { prefetchLazyModules, shouldSkip } from "@/lib/prefetch"

/** A window whose idle callbacks run only when the test says so. */
function fakeWindow() {
  const queue = new Map<number, () => void>()
  let id = 0
  const win = {
    requestIdleCallback: (cb: () => void) => {
      queue.set(++id, cb)
      return id
    },
    cancelIdleCallback: (h: number) => void queue.delete(h),
  } as unknown as Window
  /** Run the waiting idle callback, then let its import settle. */
  const idle = async () => {
    const [h, cb] = [...queue][0] ?? []
    if (!cb) return false
    queue.delete(h!)
    cb()
    await new Promise((r) => setTimeout(r))
    return true
  }
  return { win, idle, pending: () => queue.size }
}

describe("prefetching lazy code", () => {
  it("loads one module per idle moment, in order", async () => {
    const { win, idle } = fakeWindow()
    const loaded: string[] = []
    const mod = (name: string) => async () => void loaded.push(name)
    prefetchLazyModules([mod("a"), mod("b"), mod("c")], win)
    expect(loaded).toEqual([])
    await idle()
    expect(loaded).toEqual(["a"])
    while (await idle());
    expect(loaded).toEqual(["a", "b", "c"])
  })

  it("carries on past a failed download", async () => {
    const { win, idle } = fakeWindow()
    const loaded: string[] = []
    prefetchLazyModules(
      [
        () => Promise.reject(new Error("offline")),
        async () => void loaded.push("b"),
      ],
      win
    )
    while (await idle());
    expect(loaded).toEqual(["b"])
  })

  it("stops when cancelled", async () => {
    const { win, idle, pending } = fakeWindow()
    const loaded: string[] = []
    const cancel = prefetchLazyModules(
      [async () => void loaded.push("a"), async () => void loaded.push("b")],
      win
    )
    await idle()
    cancel()
    expect(pending()).toBe(0)
    while (await idle());
    expect(loaded).toEqual(["a"])
  })

  it("skips when the browser is saving data", () => {
    expect(shouldSkip({ saveData: true })).toBe(true)
    expect(shouldSkip({ saveData: false })).toBe(false)
    expect(shouldSkip(undefined)).toBe(false)
  })
})
