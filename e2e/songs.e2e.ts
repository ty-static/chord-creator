import { expect, loadExample, openApp, test } from "./fixtures"

const header = (page: import("@playwright/test").Page) => page.locator("header")

async function rename(page: import("@playwright/test").Page, title: string) {
  await page.getByTitle("Rename this song").click()
  const input = header(page).getByRole("textbox")
  await input.fill(title)
  await input.press("Enter")
  await expect(header(page)).toContainText(title)
}

test("keeps songs in My songs across reloads", async ({ page }) => {
  await openApp(page)
  await rename(page, "First tune")
  await loadExample(page, "Lo-fi Evening")

  await page.reload()
  // The last open song comes back.
  await expect(header(page)).toContainText("Lo-fi Evening")

  await page.getByRole("button", { name: "My songs" }).click()
  const dialog = page.getByRole("dialog", { name: "My songs" })
  const list = dialog.getByRole("list", { name: "Songs" })
  await expect(list).toContainText("First tune")
  await expect(list).toContainText("Lo-fi Evening")

  await list
    .getByRole("button", { name: /First tune/ })
    .first()
    .click()
  await expect(dialog).toBeHidden()
  await expect(header(page)).toContainText("First tune")
})

test("duplicates and deletes a song, with undo", async ({ page }) => {
  await openApp(page)
  await rename(page, "Keeper")
  await page.getByRole("button", { name: "My songs" }).click()
  const dialog = page.getByRole("dialog", { name: "My songs" })
  const list = dialog.getByRole("list", { name: "Songs" })

  await dialog.getByRole("button", { name: "Keeper options" }).click()
  await page.getByRole("menuitem", { name: "Duplicate" }).click()
  await expect(list.getByRole("listitem")).toHaveCount(2)

  await dialog.getByRole("button", { name: "Keeper (copy) options" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(list.getByRole("listitem")).toHaveCount(1)
  // The toast's Undo works while the dialog is open, and leaves it open.
  await page
    .locator("[data-sonner-toast]")
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(list.getByRole("listitem")).toHaveCount(2)
  await expect(dialog).toBeVisible()
})

test.describe("share links", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] })

  test("round-trip a song through a link", async ({ page, context }) => {
    await openApp(page)
    await loadExample(page, "Spanish Nights")
    await page.getByRole("button", { name: "Copy share link" }).click()
    await expect(page.getByText("Share link copied")).toBeVisible()
    const url = await page.evaluate(() => navigator.clipboard.readText())
    expect(url).toMatch(/#song=/)

    // Someone else opens it: a fresh browser profile.
    const other = await context.browser()!.newContext()
    const them = await other.newPage()
    await them.route(/^https?:\/\/(?!localhost[:/])/, (r) => r.abort())
    await them.addInitScript(() =>
      localStorage.setItem("chord-creator:tour-seen", "1")
    )
    await them.goto(url)
    await expect(them.locator("header")).toContainText("Spanish Nights")
    // The link is cleared, so a reload doesn't add it twice.
    await expect(them).not.toHaveURL(/#song=/)
    await other.close()
  })
})
