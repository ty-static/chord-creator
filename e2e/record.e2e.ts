import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { type Page } from "@playwright/test"

import { expect, openApp, test } from "./fixtures"
import { melodyWav } from "./wav"

async function openPage(page: Page) {
  await openApp(page)
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await expect(
    page.getByRole("heading", { name: "Audio to MIDI" })
  ).toBeVisible()
}

// Chromium's fake microphone plays this file, as if someone played the scale.
const micFile = join(tmpdir(), `static-sound-mic-${process.pid}.wav`)
writeFileSync(
  micFile,
  melodyWav([60, 62, 64, 65, 67, 69, 71, 72], 0.45, 0.05, 44100)
)

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${micFile}%noloop`,
    ],
  },
})

test("records a take, finds its notes and makes an arrangement", async ({
  page,
}) => {
  await openPage(page)
  await page.getByRole("button", { name: /^Record/ }).click()
  await expect(
    page.getByRole("status").filter({ hasText: "Recording" })
  ).toBeVisible()
  await expect(
    page.getByRole("meter", { name: "Microphone level" })
  ).toBeVisible()
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .exclude("[data-sonner-toaster]")
    .analyze()
  expect(
    violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target}`))
  ).toEqual([])
  await page.waitForTimeout(4800)
  await page.getByRole("button", { name: "Stop and find notes" }).click()

  const title = page.getByText(/^\d+ notes found$/)
  await expect(title).toBeVisible()
  await expect(page.getByText(/^Recording .*\.wav$/)).toBeVisible()
  const found = Number((await title.textContent())!.split(" ")[0])
  expect(found).toBeGreaterThanOrEqual(7)
  expect(found).toBeLessThanOrEqual(9)
  await expect(page.locator("dl")).toContainText("C Major")

  await page.getByRole("button", { name: "Make an arrangement" }).click()
  const dialog = page.getByRole("dialog", { name: "Import MIDI file" })
  // The tune gets chords, and a drum beat even though it had none.
  await expect(dialog.locator("[data-import-summary]")).toContainText(
    "pop drum beat"
  )
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator("header")).toContainText("Recording")
})

test("a cancelled take is thrown away", async ({ page }) => {
  await openPage(page)
  await page.getByRole("button", { name: /^Record/ }).click()
  await expect(
    page.getByRole("status").filter({ hasText: "Recording" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("button", { name: /^Record/ })).toBeVisible()
  await expect(page.getByText(/notes found/)).toBeHidden()
})

test("says so when the microphone is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Denied", "NotAllowedError"))
  })
  await openPage(page)
  await page.getByRole("button", { name: /^Record/ }).click()
  await expect(page.getByText(/Microphone access is blocked/)).toBeVisible()
  await expect(page.getByRole("button", { name: /^Record/ })).toBeEnabled()
})
