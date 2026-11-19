import AxeBuilder from "@axe-core/playwright"
import { type Page } from "@playwright/test"

import { expect, loadExample, openApp, openTab, test } from "./fixtures"

/**
 * Axe violations on the page, as "rule: element" lines (empty when clean).
 * Toasts come and go (and fade while they do), so they're checked on their
 * own, once one has settled; see "a toast" below.
 */
async function violations(page: Page, only?: string) {
  // Let dialogs finish animating in: mid-fade colours fail contrast.
  await page.waitForTimeout(600)
  const axe = new AxeBuilder({ page })
  const { violations } = await (
    only ? axe.include(only) : axe.exclude("[data-sonner-toaster]")
  ).analyze()
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`)
  )
}

test.describe("accessibility (axe)", () => {
  for (const scheme of ["light", "dark"] as const)
    test(`every editor tab, ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await loadExample(page, "Pop Anthem")
      for (const tab of ["Chords", "Melody", "Drums"] as const) {
        await openTab(page, tab)
        expect(await violations(page), tab).toEqual([])
        // axe misses a label that points at the wrong element: every
        // dropdown and button must have a name of its own.
        for (const role of ["combobox", "button"] as const)
          for (const el of await page
            .getByRole(role)
            // Toasts come and go mid-loop; they have their own check.
            .and(page.locator(":not([data-sonner-toaster] *)"))
            .all())
            if (await el.isVisible())
              await expect(el, `a ${role} in ${tab}`).toHaveAccessibleName(/\S/)
      }
    })

  for (const scheme of ["light", "dark"] as const)
    test(`a toast, ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await page.getByRole("button", { name: "Examples and more" }).click()
      await page.getByRole("menuitem", { name: "New song" }).click()
      const toast = page.locator("[data-sonner-toast]")
      await expect(toast).toHaveCount(1)
      await expect(toast).toHaveAttribute("data-mounted", "true")
      expect(await violations(page, "[data-sonner-toaster]")).toEqual([])
    })

  for (const scheme of ["light", "dark"] as const)
    test(`the chord chart, ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await loadExample(page, "Pop Anthem")
      await page.getByRole("button", { name: "Chord chart" }).click()
      await expect(
        page.getByRole("dialog", { name: "Chord chart" })
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
    })

  for (const scheme of ["light", "dark"] as const)
    test(`while playing, with WCAG 2.2 target sizes, ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      await loadExample(page, "Pop Anthem")
      await page.getByRole("button", { name: "Play", exact: true }).click()
      const stop = page.getByRole("button", { name: "Stop", exact: true })
      // Hovered: the Stop button's darkest background.
      await stop.hover()
      await page.waitForTimeout(600)
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .exclude("[data-sonner-toaster]")
        .analyze()
      expect(
        violations.flatMap((v) =>
          v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`)
        )
      ).toEqual([])
      await stop.click()
    })

  test("timeline chords say what they do", async ({ page }) => {
    await openApp(page)
    await expect(
      page.getByRole("button", { name: /^Play from / }).first()
    ).toBeVisible()
  })

  test("section style, My songs and the phone layout", async ({ page }) => {
    await openApp(page)
    await loadExample(page, "Pop Anthem")
    await page.getByRole("button", { name: "Section style" }).click()
    expect(await violations(page), "section style").toEqual([])
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "My songs" }).click()
    expect(await violations(page), "My songs").toEqual([])
    await page.keyboard.press("Escape")
    await page.setViewportSize({ width: 375, height: 800 })
    expect(await violations(page), "phone").toEqual([])
  })
})

test.describe("accessibility (axe), first visit", () => {
  test.use({ tour: true })
  test("the welcome tour", async ({ page }) => {
    // Not openApp: the tour may open before the Play button shows, and
    // then hides it from the accessibility tree.
    await page.goto("/")
    await expect(page.getByRole("dialog", { name: /Welcome/ })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })
})

test.describe("keyboard", () => {
  test("a skip link jumps past the header", async ({ page }) => {
    await openApp(page)
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to the editor" })
    await expect(skip).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("main")).toBeFocused()
  })

  test("closing a dialog gives focus back to its button", async ({ page }) => {
    await openApp(page)
    for (const name of ["Chord chart", "My songs"]) {
      const button = page.getByRole("button", { name, exact: true })
      await button.focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("dialog")).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toBeHidden()
      await expect(button, name).toBeFocused()
    }
  })

  test("the drum grid works with arrow keys", async ({ page }) => {
    await openApp(page)
    await openTab(page, "Drums")
    const step = (piece: string, n: number) =>
      page.getByRole("button", { name: `${piece} step ${n}`, exact: true })
    // One step is in the tab order; arrows move between steps.
    await step("Crash", 1).focus()
    await page.keyboard.press("ArrowDown")
    await expect(step("Open hat", 1)).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await expect(step("Open hat", 3)).toBeFocused()
    await page.keyboard.press("End")
    await expect(step("Open hat", 16)).toBeFocused()
    await expect(step("Open hat", 16)).toHaveAttribute("tabindex", "0")
    await expect(step("Open hat", 1)).toHaveAttribute("tabindex", "-1")
    // Space adds a hit, then an accent, then clears it.
    const before = await step("Open hat", 16).getAttribute("data-value")
    await page.keyboard.press("Space")
    await expect(step("Open hat", 16)).not.toHaveAttribute(
      "data-value",
      before!
    )
  })

  test("melody notes can be reached and edited from the keyboard", async ({
    page,
  }) => {
    await openApp(page)
    await loadExample(page, "Pop Anthem")
    await openTab(page, "Melody")
    const notes = page.locator("[data-note-id]")
    const first = notes.first()
    await first.focus()
    await expect(first).toHaveAttribute("aria-pressed", "true")
    await expect(first).toHaveAccessibleName(/^[A-G][♯♭]?\d, bar 1, beat 1/)
    // ] moves to the next note; arrows move the selected note.
    await page.keyboard.press("]")
    const second = notes.nth(1)
    await expect(second).toBeFocused()
    const name = await second.getAttribute("aria-label")
    await page.keyboard.press("ArrowUp")
    await expect(page.locator("[data-note-id]:focus")).not.toHaveAttribute(
      "aria-label",
      name!
    )
  })
})
