import { readFile } from "node:fs/promises"

import AxeBuilder from "@axe-core/playwright"
import { type Page } from "@playwright/test"

import { expect, openApp, test } from "./fixtures"
import { melodyWav } from "./wav"

const scale = {
  name: "scale.wav",
  mimeType: "audio/wav",
  buffer: melodyWav([60, 62, 64, 65, 67, 69, 71, 72]),
}

async function openPage(page: Page) {
  await openApp(page)
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await expect(
    page.getByRole("heading", { name: "Audio to MIDI" })
  ).toBeVisible()
}

const converter = (page: Page) => page.locator("main:visible input[type=file]")

test("turns a recording into MIDI notes", async ({ page }) => {
  await openPage(page)
  await converter(page).setInputFiles(scale)
  await expect(page.getByText("8 notes found")).toBeVisible()
  await expect(page.getByText("scale.wav")).toBeVisible()
  const facts = page.locator("dl")
  await expect(facts).toContainText("C Major")
  await expect(facts).toContainText("C4 – C5")
  await expect(
    page.getByRole("img", { name: /with the 8 notes found/ })
  ).toBeVisible()

  // Download the notes as a MIDI file.
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download MIDI" }).click(),
  ])
  expect(file.suggestedFilename()).toBe("scale.mid")
  const bytes = await readFile(await file.path())
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("MThd")

  // Or open them as a song, through the usual MIDI import.
  await page.getByRole("button", { name: "Make an arrangement" }).click()
  const dialog = page.getByRole("dialog", { name: "Import MIDI file" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Melody")
  // Choose a style: it sets the drums, chords, bass and sounds.
  await expect(dialog.locator("[data-import-summary]")).toContainText(
    "pop drum beat"
  )
  await dialog.getByRole("combobox", { name: "Style" }).click()
  await page.getByRole("option", { name: "Reggae" }).click()
  await expect(dialog.locator("[data-style-hint]")).toContainText("one-drop")
  await expect(dialog.locator("[data-import-summary]")).toContainText(
    "reggae drum beat"
  )
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("tab", { name: "Song" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.locator("header")).toContainText("scale")
  await expect(
    page.getByRole("combobox", { name: "Chord rhythm", exact: true })
  ).toHaveText("Off-beat")

  // The style is remembered for next time; "Just chords" has no drums.
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await page.getByRole("button", { name: "Make an arrangement" }).click()
  await expect(dialog.getByRole("combobox", { name: "Style" })).toHaveText(
    "Reggae"
  )
  await dialog.getByRole("combobox", { name: "Style" }).click()
  await page.getByRole("option", { name: "Just chords" }).click()
  await expect(dialog.locator("[data-import-summary]")).toContainText(
    "no drums"
  )
})

test("a recording opened from the song page goes to Audio to MIDI", async ({
  page,
}) => {
  await openApp(page)
  await page.locator('header input[type="file"]').setInputFiles(scale)
  await expect(
    page.getByRole("tab", { name: "Audio to MIDI" })
  ).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("8 notes found")).toBeVisible()
  // Switching pages keeps the result.
  await page.getByRole("tab", { name: "Song" }).click()
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await expect(page.getByText("8 notes found")).toBeVisible()
})

test("says so when a file isn't a recording it can read", async ({ page }) => {
  await openPage(page)
  await converter(page).setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not really a wav file"),
  })
  await expect(page.getByText(/Couldn't read broken\.wav/)).toBeVisible()
})

for (const scheme of ["light", "dark"] as const)
  test(`Audio to MIDI is accessible, ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openPage(page)
    await converter(page).setInputFiles(scale)
    await expect(page.getByText("8 notes found")).toBeVisible()
    await page.waitForTimeout(600)
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .exclude("[data-sonner-toaster]")
      .analyze()
    expect(
      violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target}`))
    ).toEqual([])
  })
