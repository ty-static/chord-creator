import { describe, expect, it } from "vitest"

import { isIos, isStandalone } from "@/lib/pwa"

const nav = (userAgent: string, maxTouchPoints = 0) =>
  ({ userAgent, maxTouchPoints }) as Navigator

const win = (standaloneQuery: boolean, iosStandalone?: boolean) =>
  ({
    matchMedia: () => ({ matches: standaloneQuery }),
    navigator: { standalone: iosStandalone },
  }) as unknown as Window

describe("installing as an app", () => {
  it("knows iPhones and iPads, which install from the Share menu", () => {
    expect(
      isIos(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"))
    ).toBe(true)
    // iPads say they're Macs, but have a touch screen.
    expect(
      isIos(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5))
    ).toBe(true)
    expect(isIos(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"))).toBe(
      false
    )
    expect(isIos(nav("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5))).toBe(
      false
    )
  })

  it("knows when it's running installed", () => {
    expect(isStandalone(win(true))).toBe(true)
    expect(isStandalone(win(false, true))).toBe(true) // iOS home screen
    expect(isStandalone(win(false))).toBe(false)
  })
})
