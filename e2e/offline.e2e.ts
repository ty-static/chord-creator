import { expect, loadExample, openApp, test } from "./fixtures"

test("installs as an app: manifest and icons", async ({ page, request }) => {
  await openApp(page)
  const href = await page.locator('link[rel="manifest"]').getAttribute("href")
  const manifest = await (await request.get(href!)).json()
  expect(manifest.name).toBe("Chord Creator")
  expect(manifest.display).toBe("standalone")
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src)
    expect(res.ok(), icon.src).toBe(true)
  }
  expect(
    manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")
  ).toBe(true)
})

test("offers to install when the browser allows it", async ({ page }) => {
  await openApp(page)
  // Headless Chrome never offers itself, so stand in for its install prompt.
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt") as Event &
      Record<string, unknown>
    e.prompt = async () => {}
    e.userChoice = Promise.resolve({ outcome: "accepted" })
    window.dispatchEvent(e)
  })
  await page.getByRole("button", { name: "Examples and more" }).click()
  await page.getByRole("menuitem", { name: "Install app" }).click()
  await expect(page.getByText("Chord Creator is installed")).toBeVisible()
})

test("opens and plays with no network once it has loaded", async ({
  browser,
}) => {
  // Chrome skips service workers while Playwright intercepts requests, so
  // this test uses its own page without the blocking the others have. It
  // goes offline before playing, so no samples are downloaded.
  const context = await browser.newContext()
  await context.addInitScript(() =>
    localStorage.setItem("chord-creator:tour-seen", "1")
  )
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await openApp(page)
  // Wait until the service worker has cached the app.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await context.setOffline(true)
  await expect(page.getByText("You're offline")).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Play", exact: true })
  ).toBeVisible()

  // Code that loads on first use comes from the cache too.
  await loadExample(page, "Pop Anthem")
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await page.getByRole("button", { name: "My songs" }).click()
  await expect(page.getByRole("dialog", { name: "My songs" })).toBeVisible()
  expect(errors).toEqual([])
  await context.close()
})
