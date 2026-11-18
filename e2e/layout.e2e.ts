import { type Page } from "@playwright/test"

import { expect, openApp, openTab, test } from "./fixtures"

/** The header fits, and the song title isn't squeezed out. */
async function headerFits(page: Page) {
  const fits = await page.locator("header > div").evaluate((el) => ({
    overflow: el.scrollWidth > el.clientWidth,
    title: el.querySelector(".truncate")?.clientWidth ?? 0,
    page: document.documentElement.scrollWidth > window.innerWidth,
  }))
  expect(fits.overflow, "header overflows").toBe(false)
  expect(fits.page, "page scrolls sideways").toBe(false)
  expect(fits.title, "song title width").toBeGreaterThan(60)
}

for (const width of [375, 640, 768, 1024, 1280])
  test(`header fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openApp(page)
    await headerFits(page)
  })

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true })

  test("the menu holds songs, import, redo and the theme", async ({ page }) => {
    await openApp(page)
    await expect(page.getByRole("button", { name: "My songs" })).toBeHidden()
    await page.getByRole("button", { name: "Examples and more" }).click()
    for (const item of ["My songs", "Import a file", "Redo", /theme$/])
      await expect(page.getByRole("menuitem", { name: item })).toBeVisible()
    await page.getByRole("menuitem", { name: "My songs" }).click()
    await expect(
      page.getByRole("dialog", { name: "My songs" })
    ).toBeInViewport()
  })

  test("nothing spills off the side of the screen", async ({ page }) => {
    await openApp(page)
    for (const tab of ["Chords", "Melody", "Drums"] as const) {
      await openTab(page, tab)
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      )
      expect(wide, `${tab} tab scrolls sideways`).toBe(false)
    }
  })

  test("a long title is shortened, not cut off", async ({ page }) => {
    await openApp(page)
    await page.getByTitle("Rename this song").click()
    const input = page.locator("header").getByRole("textbox")
    await input.fill("A really quite long song title for testing")
    await input.press("Enter")
    await headerFits(page)
  })
})

test("light and dark themes", async ({ page }) => {
  await openApp(page)
  const dark = () =>
    page.locator("html").evaluate((h) => h.classList.contains("dark"))
  const before = await dark()
  await page.getByRole("button", { name: "Toggle theme" }).click()
  await expect.poll(dark).toBe(!before)
  await page.reload()
  await expect.poll(dark).toBe(!before)
})
