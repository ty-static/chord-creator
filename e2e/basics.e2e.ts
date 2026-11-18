import { expect, loadExample, openApp, openTab, test } from "./fixtures"

test.describe("first visit", () => {
  test.use({ tour: true })

  test("shows the welcome tour once", async ({ page }) => {
    await page.goto("/")
    const tour = page.getByRole("dialog", { name: /Welcome/ })
    await expect(tour).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(tour).toBeHidden()
    await page.reload()
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible()
    await expect(tour).toBeHidden()
  })
})

test("adds chords from the palette, with undo and redo", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", { name: "Examples and more" }).click()
  await page.getByRole("menuitem", { name: "New song" }).click()
  await expect(page.locator("header")).toContainText("Untitled song")
  const progression = page.getByRole("button", {
    name: /^Drag to reorder chord/,
  })
  const before = 1 // a new song starts on the I chord
  await expect(progression).toHaveCount(before)

  const palette = page.locator('[data-slot="card"]', {
    has: page.getByText(/^Chords in /),
  })
  // The first match is the palette tile (a "Next" suggestion may repeat it).
  await palette
    .getByRole("button", { name: /^F\s*IV$/ })
    .first()
    .click()
  await palette
    .getByRole("button", { name: /^G\s*V$/ })
    .first()
    .click()
  await expect(progression).toHaveCount(before + 2)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(progression).toHaveCount(before + 1)
  await page.keyboard.press("Control+Shift+Z")
  await expect(progression).toHaveCount(before + 2)
})

test("plays and stops", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  await page.getByRole("button", { name: "Play" }).click()
  const stop = page.getByRole("button", { name: "Stop" })
  await expect(stop).toBeVisible({ timeout: 15_000 })
  // The playhead moves.
  const playhead = page.locator(".bg-destructive.w-0\\.5")
  await expect(playhead).toBeVisible()
  await stop.click()
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible()
})

test("switches between the editor tabs", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  await openTab(page, "Melody")
  await expect(page.getByText("Note density")).toBeVisible()
  await openTab(page, "Drums")
  await expect(
    page.getByRole("combobox", { name: "Fill at the end of this section" })
  ).toBeVisible()
  await openTab(page, "Chords")
  await expect(page.getByText(/^Chords in C Major$/)).toBeVisible()
})
