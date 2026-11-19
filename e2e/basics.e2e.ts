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
    await expect(
      page.getByRole("button", { name: "Play", exact: true })
    ).toBeVisible()
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
  await page.getByRole("button", { name: "Play", exact: true }).click()
  const stop = page.getByRole("button", { name: "Stop" })
  await expect(stop).toBeVisible({ timeout: 15_000 })
  // The playhead moves.
  const playhead = page.locator(".bg-destructive.w-0\\.5")
  await expect(playhead).toBeVisible()
  await stop.click()
  await expect(
    page.getByRole("button", { name: "Play", exact: true })
  ).toBeVisible()
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

test("sets the tempo by typing or tapping, and plays a metronome", async ({
  page,
}) => {
  await openApp(page)
  const bpm = page.getByRole("spinbutton", { name: "Tempo" })
  await bpm.fill("132")
  await bpm.press("Enter")
  await expect(page.getByRole("slider", { name: "Tempo" })).toHaveAttribute(
    "aria-valuenow",
    "132"
  )
  // Out of range: kept in range.
  await bpm.fill("400")
  await bpm.press("Enter")
  await expect(bpm).toHaveValue("200")
  // Escape throws away what was typed.
  await bpm.fill("150")
  await bpm.press("Escape")
  await expect(bpm).toHaveValue("200")
  await expect(bpm).not.toBeFocused()

  // Four taps half a second apart: 120 BPM.
  const tap = page.getByRole("button", { name: "Tap tempo" })
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(1000)
  for (let i = 0; i < 4; i++) {
    await tap.click()
    await page.clock.runFor(500)
  }
  await expect(bpm).toHaveValue("120")
  await page.getByRole("button", { name: "Undo" }).first().click()
  await expect(bpm).toHaveValue("200")
})

test("plays a metronome, remembered after a reload", async ({ page }) => {
  await openApp(page)
  const metronome = page.getByRole("switch", { name: /Metronome/ })
  await metronome.click()
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("switch", { name: /Metronome/ })).toBeChecked()
})

test("suggests chords with a reason", async ({ page }) => {
  await openApp(page)
  // The first song is I–V–vi–IV: going round again, I comes next.
  await expect(page.getByTitle("Carries on V–vi–IV–I")).toBeVisible()
})

test("replaces a chord, or inserts after it, from the palette", async ({
  page,
}) => {
  await openApp(page)
  const lane = page.getByTitle(/^Play from /)
  await expect(lane).toHaveText(["C", "G", "Am", "F"])

  await page
    .getByRole("button", { name: "Change chord 2 from the palette" })
    .click()
  await expect(
    page.getByRole("status").filter({ hasText: "Replacing" })
  ).toHaveText(/Replacing chord #2 \(G\)/)
  // The palette's Dm (ii).
  await page
    .getByRole("button", { name: /^Dm\s*ii$/ })
    .first()
    .click()
  await expect(lane).toHaveText(["C", "Dm", "Am", "F"])

  // Insert after: each chord goes after the last one put in.
  await page.getByRole("radio", { name: "Insert after" }).click()
  await page
    .getByRole("button", { name: /^Em\s*iii$/ })
    .first()
    .click()
  await page
    .getByRole("button", { name: /^G\s*V$/ })
    .first()
    .click()
  await expect(lane).toHaveText(["C", "Dm", "Em", "G", "Am", "F"])

  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByText(/Inserting after/)).toBeHidden()
  // Back to adding at the end.
  await page
    .getByRole("button", { name: /^C\s*I$/ })
    .first()
    .click()
  await expect(lane).toHaveText(["C", "Dm", "Em", "G", "Am", "F", "C"])
})

test("says why the top chord is suggested", async ({ page }) => {
  await openApp(page)
  await expect(page.getByText("C: carries on V–vi–IV–I")).toBeVisible()
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("shows the music first and folds the finer settings", async ({
    page,
  }) => {
    await openApp(page)
    const chords = await page
      .getByText(/^Chords in /)
      .first()
      .boundingBox()
    const key = await page.getByText("Key & Tempo").boundingBox()
    expect(chords!.y).toBeLessThan(key!.y)

    const feel = page.getByRole("button", { name: /Feel & arrangement/ })
    await expect(feel).toHaveAttribute("aria-expanded", "false")
    await expect(feel).toContainText("Block · roots bass")
    await expect(page.getByRole("slider", { name: "Swing" })).toBeHidden()
    await feel.click()
    await expect(page.getByRole("slider", { name: "Swing" })).toBeVisible()
  })
})
