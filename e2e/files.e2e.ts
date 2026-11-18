import { readFile } from "node:fs/promises"

import { type Page } from "@playwright/test"

import { expect, loadExample, openApp, test } from "./fixtures"

/** Click a button and return the downloaded file's name and bytes. */
async function download(page: Page, click: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent("download"), click()])
  const path = await file.path()
  return { name: file.suggestedFilename(), path, bytes: await readFile(path) }
}

/** A downloaded file to choose in a file picker, under its real name. */
const asFile = (f: { name: string; bytes: Buffer }) => ({
  name: f.name,
  mimeType: "application/octet-stream",
  buffer: f.bytes,
})

const ascii = (b: Buffer, from: number, to: number) =>
  b.subarray(from, to).toString("latin1")

test("exports a MIDI file and imports it back", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Pop Anthem")
  const midi = await download(page, () =>
    page.getByRole("button", { name: "MIDI", exact: true }).click()
  )
  expect(midi.name).toBe("pop-anthem.mid")
  expect(ascii(midi.bytes, 0, 4)).toBe("MThd")
  // Conductor track plus chords, melody, bass and drums.
  expect(midi.bytes.readUInt16BE(10)).toBe(5)

  await page.locator('input[type="file"]').setInputFiles(asFile(midi))
  const dialog = page.getByRole("dialog", { name: "Import MIDI file" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Chords")
  await dialog.getByRole("button", { name: "Import", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator("header")).toContainText("pop anthem")
  await expect(
    page.getByRole("button", { name: /^Drag to reorder chord/ }).first()
  ).toBeVisible()
})

test("renders a WAV file", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Lo-fi Evening")
  await page.getByRole("combobox", { name: "What to export" }).click()
  await page
    .getByRole("option", { name: /Chords/ })
    .first()
    .click()
  const wav = await download(page, () =>
    page.getByRole("button", { name: "WAV", exact: true }).click()
  )
  expect(wav.name).toMatch(/\.wav$/)
  expect(ascii(wav.bytes, 0, 4)).toBe("RIFF")
  expect(ascii(wav.bytes, 8, 12)).toBe("WAVE")
  // 16-bit stereo at 44.1 kHz, and more than a second of sound.
  expect(wav.bytes.readUInt16LE(22)).toBe(2)
  expect(wav.bytes.readUInt32LE(24)).toBe(44_100)
  expect(wav.bytes.length).toBeGreaterThan(44_100 * 4)
  await expect(page.getByText(/^Exported /)).toBeVisible()
})

test("exports stems: one WAV per track in a zip", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Lo-fi Evening")
  const zip = await download(page, () =>
    page.getByRole("button", { name: /^Stems/ }).click()
  )
  expect(zip.name).toBe("lo-fi-evening_stems.zip")
  // Walk the zip's central directory.
  const end = zip.bytes.length - 22
  expect(zip.bytes.readUInt32LE(end)).toBe(0x06054b50)
  let at = zip.bytes.readUInt32LE(end + 16)
  const files: { name: string; size: number; offset: number }[] = []
  for (let i = 0; i < zip.bytes.readUInt16LE(end + 10); i++) {
    const nameLen = zip.bytes.readUInt16LE(at + 28)
    files.push({
      name: ascii(zip.bytes, at + 46, at + 46 + nameLen),
      size: zip.bytes.readUInt32LE(at + 20),
      offset: zip.bytes.readUInt32LE(at + 42),
    })
    at += 46 + nameLen
  }
  expect(files.map((f) => f.name)).toEqual(
    ["chords", "melody", "bass", "drums"].map((t) => `lo-fi-evening_${t}.wav`)
  )
  // Each is a WAV, and all are the same length so they line up.
  for (const f of files) {
    const data = f.offset + 30 + f.name.length
    expect(ascii(zip.bytes, data, data + 4)).toBe("RIFF")
    expect(f.size).toBe(files[0].size)
  }
  expect(files[0].size).toBeGreaterThan(44_100 * 4)
  await expect(page.getByText(/^Exported .*_stems.zip/)).toBeVisible()
})

test("downloads a song file and opens it again", async ({ page }) => {
  await openApp(page)
  await loadExample(page, "Epic Score")
  await page.getByRole("button", { name: "My songs" }).click()
  const dialog = page.getByRole("dialog", { name: "My songs" })
  await dialog.getByRole("button", { name: "Epic Score options" }).click()
  const file = await download(page, () =>
    page.getByRole("menuitem", { name: "Download" }).click()
  )
  expect(file.name).toMatch(/\.json$/)
  expect(JSON.parse(file.bytes.toString("utf8")).song).toMatchObject({
    title: "Epic Score",
  })
  await dialog.getByRole("button", { name: "Close" }).first().click()
  await expect(dialog).toBeHidden()

  await page.getByRole("button", { name: "Examples and more" }).click()
  await page.getByRole("menuitem", { name: "New song" }).click()
  await expect(page.locator("header")).toContainText("Untitled song")
  await page.locator('input[type="file"]').setInputFiles(asFile(file))
  await expect(page.locator("header")).toContainText("Epic Score")
})
