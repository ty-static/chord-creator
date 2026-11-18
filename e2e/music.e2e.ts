import { type Page } from "@playwright/test"

import { expect, loadExample, openApp, openTab, test } from "./fixtures"

/** Select a section by clicking its band on the timeline. */
async function editSection(page: Page, name: string) {
  await page.getByTitle(`Edit ${name}`, { exact: true }).first().click()
  await expect(page.getByText("Editing")).toBeVisible()
}

test("a key change shows the section in its new key", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  await editSection(page, "Chorus")
  await page.getByRole("button", { name: "Section style" }).click()
  const up = page.getByRole("button", { name: "Key change up a semitone" })
  await up.click()
  await up.click()
  await page.keyboard.press("Escape")

  await expect(page.getByText(/^Chords in D Major$/)).toBeVisible()
  await expect(
    page.getByText(/This section plays 2 semitones higher/)
  ).toBeVisible()
  // Timeline: the chorus bands carry a key badge and D-major chord names.
  await expect(
    page.getByTitle("Edit Chorus (in D Major)", { exact: true })
  ).toHaveCount(3)
  await expect(
    page.getByTitle("Play from D", { exact: true }).first()
  ).toBeVisible()

  // The verse is still in C.
  await editSection(page, "Verse")
  await expect(page.getByText(/^Chords in C Major$/)).toBeVisible()
})

test("adds chords from outside the key", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", { name: "Examples and more" }).click()
  await page.getByRole("menuitem", { name: "New song" }).click()
  await expect(page.locator("header")).toContainText("Untitled song")
  await expect(page.getByText("Outside the key")).toBeVisible()
  await page
    .getByRole("button", { name: /^D7\s*V7\/V$/ })
    .first()
    .click()
  await page
    .getByRole("button", { name: /^A♭\s*♭VI$/ })
    .first()
    .click()
  const chords = page.getByRole("button", { name: /^Drag to reorder chord/ })
  await expect(chords).toHaveCount(3)
  // The timeline names them too.
  await expect(page.getByTitle("Play from D7", { exact: true })).toBeVisible()
  await expect(page.getByTitle("Play from A♭", { exact: true })).toBeVisible()
})

test("links melodies across sections", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  await editSection(page, "Chorus")
  await openTab(page, "Melody")

  const menu = page.getByRole("button", { name: "Sections" })
  await menu.click()
  await page.getByRole("menuitem", { name: "A · Verse" }).first().click()
  await page.getByRole("menuitem", { name: /Follow the chords/ }).click()
  await expect(page.getByText("Melody from A · Verse")).toBeVisible()

  await menu.click()
  await page.getByRole("menuitem", { name: "Lead into C · Bridge" }).click()
  await expect(page.getByText("Leads into C · Bridge")).toBeVisible()

  // Both are single undo steps.
  await page.getByRole("button", { name: "Undo" }).first().click()
  await page.getByRole("button", { name: "Undo" }).first().click()
  await expect(page.getByRole("button", { name: "Redo" }).first()).toBeEnabled()
})

test("generates a melody and a drum fill", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", { name: "Examples and more" }).click()
  await page.getByRole("menuitem", { name: "New song" }).click()
  await expect(page.locator("header")).toContainText("Untitled song")
  await openTab(page, "Melody")
  await expect(page.getByText(/^0 notes/)).toBeVisible()
  await page.getByRole("button", { name: "Generate" }).click()
  await expect(page.getByText(/^0 notes/)).toBeHidden()

  await openTab(page, "Drums")
  const fill = page.getByRole("combobox", {
    name: "Fill at the end of this section",
  })
  await fill.click()
  await page.getByRole("option", { name: /Tom/ }).click()
  await expect(fill).toContainText(/Tom/)
})

test("switches the song to 6/8", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  await page.getByLabel("Time signature").click()
  await page.getByRole("option", { name: /^6\/8/ }).click()
  await expect(page.getByText("Now in 6/8")).toBeVisible()
  await expect(page.getByLabel("Time signature")).toHaveText("6/8")

  // Chord lengths are counted in bars of 6/8.
  await openTab(page, "Chords")
  await expect(page.getByText("1 bar").first()).toBeVisible()

  // The drum grid is one bar of 6/8: twelve 16th-note steps, two beats.
  await openTab(page, "Drums")
  await expect(
    page.getByRole("button", { name: /^Kick step \d+$/ })
  ).toHaveCount(12)
  await expect(page.getByLabel("Drum pattern")).toHaveText("Ballad")

  // The export writes a 6/8 time signature.
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "MIDI", exact: true }).click()
  const file = await (await download).path()
  const { readFileSync } = await import("node:fs")
  const bytes = [...readFileSync(file)]
  const at = bytes.findIndex(
    (b, i) => b === 0xff && bytes[i + 1] === 0x58 && bytes[i + 2] === 4
  )
  expect(bytes.slice(at + 3, at + 5)).toEqual([6, 3])

  // And the setting is saved with the song.
  await page.reload()
  await expect(page.getByLabel("Time signature")).toHaveText("6/8")
})

test("picks chord rhythm patterns for the song and a section", async ({
  page,
}) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  await page.getByLabel("Chord rhythm", { exact: true }).click()
  await page.getByRole("option", { name: "Strum" }).click()
  await expect(page.getByText(/Down and up strums like a guitar/)).toBeVisible()

  // One section plays oom-pah instead.
  await page.getByRole("button", { name: "Section style" }).click()
  await page.getByLabel("Chord rhythm for this section").click()
  await expect(page.getByRole("option", { name: "Song (Strum)" })).toBeVisible()
  await page.getByRole("option", { name: "Oom-pah" }).click()
  await page.keyboard.press("Escape")
  await expect(
    page.getByText("oom-pah", { exact: false }).first()
  ).toBeVisible()

  // Plays without errors, and is saved.
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await page.reload()
  await expect(page.getByLabel("Chord rhythm", { exact: true })).toHaveText(
    "Strum"
  )
})

test("adds an intro and outro, an ending and a count-in", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Classic Rock")

  const add = async (item: RegExp) => {
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await page.getByRole("menuitem", { name: item }).click()
  }
  await add(/^Intro, from the first section/)
  await expect(page.getByText("Added Intro at the start")).toBeVisible()
  await add(/^Outro, from the last section/)
  await expect(page.getByText("Added Outro at the end")).toBeVisible()
  // The form now starts with the intro and ends with the outro.
  const chips = page.getByRole("button", { name: /part \d+ of the form/ })
  await expect(chips.first()).toHaveAccessibleName(/^\w Intro .*part 1 of/)
  await expect(chips.last()).toHaveAccessibleName(/^\w Outro /)

  await page.getByRole("combobox", { name: /^Ending/ }).click()
  await page.getByRole("option", { name: "Final chord" }).click()
  await expect(page.getByRole("combobox", { name: /^Ending/ })).toContainText(
    "Final chord"
  )

  await page.getByLabel("Count-in").click()
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Stop", exact: true }).click()

  // The ending is saved with the song, the count-in as a preference.
  await page.reload()
  await expect(page.getByRole("combobox", { name: /^Ending/ })).toContainText(
    "Final chord"
  )
  await expect(page.getByLabel("Count-in")).toBeChecked()
})

test("plays a section at its own tempo", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  await editSection(page, "Chorus")
  await page.getByRole("button", { name: "Section style" }).click()
  await page.getByLabel("Tempo for this section").click()
  await page.getByRole("option", { name: /^Half time/ }).click()
  await page.getByLabel("Slow down at the end").click()
  await page.keyboard.press("Escape")
  await expect(page.getByText(/half time · slows down/).first()).toBeVisible()
  await expect(page.getByText("Some sections change it")).toBeVisible()

  // Plays without errors, and is saved.
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await page.reload()
  await editSection(page, "Chorus")
  await page.getByRole("button", { name: "Section style" }).click()
  await expect(page.getByLabel("Tempo for this section")).toContainText(
    "Half time"
  )
  await expect(page.getByLabel("Slow down at the end")).toBeChecked()
})
