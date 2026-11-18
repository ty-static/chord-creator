import { type Page, test as base, expect } from "@playwright/test"

/**
 * Every test gets a page that:
 * - can't reach the internet, so instruments fall back to the built-in
 *   synth (fast and the same every run);
 * - has the welcome tour marked as seen (one test turns this off);
 * - fails the test on any uncaught error or console.error.
 */
export const test = base.extend<{ tour: boolean; errors: string[] }>({
  tour: [false, { option: true }],
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(e.message))
      page.on("console", (m) => {
        if (m.type() !== "error") return
        // Blocked sample downloads are expected.
        if (/Failed to load resource|net::ERR_/.test(m.text())) return
        errors.push(m.text())
      })
      await use(errors)
      expect(errors, "errors in the page").toEqual([])
    },
    { auto: true },
  ],
  page: async ({ page, tour }, use) => {
    await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort())
    if (!tour)
      await page.addInitScript(() =>
        localStorage.setItem("chord-creator:tour-seen", "1")
      )
    await use(page)
  },
})

export { expect }

/** Open the app and wait for it to be ready. */
export async function openApp(page: Page, path = "/") {
  await page.goto(path)
  await expect(
    page.getByRole("button", { name: /^(Play|Stop)$/ })
  ).toBeVisible()
}

/** Load one of the example songs from the header menu. */
export async function loadExample(page: Page, name: string) {
  await page.getByRole("button", { name: "Examples and more" }).click()
  await page.getByRole("menuitem", { name: new RegExp(name) }).click()
  await expect(page.locator("header")).toContainText(name)
}

/** Switch the editor to the Chords, Melody or Drums tab. */
export async function openTab(page: Page, name: "Chords" | "Melody" | "Drums") {
  await page.getByRole("tab", { name, exact: true }).click()
}
