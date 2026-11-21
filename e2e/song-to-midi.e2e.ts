import AxeBuilder from "@axe-core/playwright"
import { type Page } from "@playwright/test"

import { expect, openApp, test } from "./fixtures"
import { melodyWav } from "./wav"

const song = {
  name: "song.wav",
  mimeType: "audio/wav",
  buffer: melodyWav([60, 64, 67, 72]),
}

async function openSongMode(page: Page) {
  await openApp(page)
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await page.getByRole("radio", { name: "A full song" }).click()
}

test("a full song waits to be split into instruments", async ({ page }) => {
  await openSongMode(page)
  await expect(page.getByText(/split into vocals, bass, drums/)).toBeVisible()
  await page.locator("main:visible input[type=file]").setInputFiles(song)

  // Nothing is worked out until asked: it means a large download.
  const split = page.getByRole("button", { name: "Split into instruments" })
  await expect(split).toBeVisible()
  await expect(page.getByText(/about 172 MB/)).toBeVisible()
  await expect(page.getByText(/notes found/)).toBeHidden()
  await expect(page.getByLabel("Sensitivity")).toBeHidden()
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .exclude("[data-sonner-toaster]")
    .analyze()
  expect(
    violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target}`))
  ).toEqual([])

  // The model can't be downloaded here (the tests are offline), which
  // shows as a message, not a hang.
  await split.click()
  await expect(
    page.getByText(/Couldn't download the instrument splitter/)
  ).toBeVisible({ timeout: 20_000 })
  await expect(split).toBeEnabled()

  // The choice is remembered, and One melody finds the notes as before.
  await page.reload()
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await expect(page.getByRole("radio", { name: "A full song" })).toBeChecked()
  await page.locator("main:visible input[type=file]").setInputFiles(song)
  await page.getByRole("radio", { name: "One melody" }).click()
  await expect(page.getByText("4 notes found")).toBeVisible()
})
