import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, openApp, test } from "./fixtures"
import { melodyWav } from "./wav"

// The fake microphone sings a scale in time with a 120 BPM click: quiet
// through the count-in, then one note a beat.
const micFile = join(tmpdir(), `static-sound-click-${process.pid}.wav`)
writeFileSync(
  micFile,
  melodyWav([60, 62, 64, 65, 67, 69, 71, 72], 0.45, 0.05, 44100, 2.42)
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

test("records to a click, keeping its tempo", async ({ page }) => {
  await openApp(page)
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await page.getByRole("switch", { name: "Click while recording" }).click()
  const tempo = page.getByRole("spinbutton", { name: "Click tempo" })
  await tempo.fill("120")
  await tempo.press("Enter")
  await expect(page.getByRole("button", { name: /^Record/ })).toContainText(
    "120 BPM"
  )

  await page.getByRole("button", { name: /^Record/ }).click()
  await expect(
    page.getByRole("status").filter({ hasText: "Count-in" })
  ).toBeVisible()
  await expect(
    page.getByRole("status").filter({ hasText: /^Recording$/ })
  ).toBeVisible({ timeout: 4000 })
  await page.waitForTimeout(4300)
  await page.getByRole("button", { name: "Stop and find notes" }).click()

  const title = page.getByText(/^\d+ notes found$/)
  await expect(title).toBeVisible()
  const found = Number((await title.textContent())!.split(" ")[0])
  expect(found).toBeGreaterThanOrEqual(7)
  expect(found).toBeLessThanOrEqual(9)
  const facts = page.locator("dl")
  await expect(facts).toContainText("Tempo (click)")
  await expect(facts).toContainText("120 BPM")
  await expect(facts).toContainText("C Major")

  // The take starts on the first downbeat, so the first note does too
  // (within 0.15 s, under a third of a beat: the fake microphone starts a
  // little before the page asks for it, so its timing is only roughly known).
  const start = await page.evaluate(async () => {
    const audio = document.querySelector("audio")!
    if (!audio.duration) await new Promise((r) => (audio.onloadedmetadata = r))
    const x = Number(
      document.querySelector("svg[role=img] rect")!.getAttribute("x")
    )
    return (x / 600) * audio.duration
  })
  expect(Math.abs(start)).toBeLessThan(0.15)

  // The setting is remembered.
  await page.reload()
  await page.getByRole("tab", { name: "Audio to MIDI" }).click()
  await expect(
    page.getByRole("switch", { name: "Click while recording" })
  ).toBeChecked()
})
