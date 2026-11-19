import { readFile } from "node:fs/promises"

import AxeBuilder from "@axe-core/playwright"
import { type Page } from "@playwright/test"

import { expect, openApp, test } from "./fixtures"

/** A 16-bit mono WAV of a few notes, each a tone with a couple of overtones. */
function melodyWav(notes: number[], seconds = 0.45, gap = 0.05, rate = 22050) {
  const len = Math.round(notes.length * (seconds + gap) * rate)
  const data = Buffer.alloc(len * 2)
  notes.forEach((midi, k) => {
    const f = 440 * 2 ** ((midi - 69) / 12)
    const from = Math.round(k * (seconds + gap) * rate)
    for (let i = 0; i < seconds * rate; i++) {
      const t = i / rate
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 2)
      const v =
        0.4 *
        env *
        (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t))
      data.writeInt16LE(Math.round(v * 32767), (from + i) * 2)
    }
  })
  const head = Buffer.alloc(44)
  head.write("RIFF", 0, "latin1")
  head.writeUInt32LE(36 + data.length, 4)
  head.write("WAVEfmt ", 8, "latin1")
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write("data", 36, "latin1")
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

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
  await page.getByRole("button", { name: "Open as a song" }).click()
  const dialog = page.getByRole("dialog", { name: "Import MIDI file" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Melody")
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("tab", { name: "Song" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.locator("header")).toContainText("scale")
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
