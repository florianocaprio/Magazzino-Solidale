import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

async function panel(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 768) {
    const drawer = page.locator('[data-mobile="true"][data-sidebar="sidebar"]');
    if (!(await drawer.isVisible()))
      await page.locator('header [data-sidebar="trigger"]').click();
    await expect(drawer).toBeVisible();
    return drawer;
  }
  return page.locator('[data-slot="sidebar-inner"]');
}

// Compute actual rendered foreground/background composites rather than treating
// CSS class names as proof of contrast. Returns only numeric measurements.
async function contrast(page: Page) {
  return page.locator('.app-nav-link[aria-current="page"]').evaluate((link) => {
    const rgba = (s: string) => {
      const n = s.match(/[\d.]+/g)?.map(Number) ?? [];
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const composite = (top: number[], bottom: number[]) =>
      top
        .slice(0, 3)
        .map((c, i) => c * top[3] + bottom[i] * (1 - top[3]))
        .concat(1);
    const background = (element: Element | null): number[] => {
      if (!element) return [255, 255, 255, 1];
      return composite(
        rgba(getComputedStyle(element).backgroundColor),
        background(element.parentElement),
      );
    };
    const luminance = (color: number[]) =>
      color
        .slice(0, 3)
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: number[], b: number[]) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) /
      (Math.min(luminance(a), luminance(b)) + 0.05);
    const style = getComputedStyle(link),
      group = link
        .closest('[data-sidebar="group"]')!
        .querySelector('[data-current="true"]')!;
    const groupStyle = getComputedStyle(group);
    return {
      text: ratio(rgba(style.color), background(link)),
      indicator: ratio(rgba(style.borderInlineStartColor), background(link)),
      focus: ratio(rgba(style.outlineColor), background(link.parentElement)),
      outlineWidth: parseFloat(style.outlineWidth),
      groupText: ratio(rgba(groupStyle.color), background(group)),
      groupIndicator: ratio(
        rgba(groupStyle.borderInlineStartColor),
        background(group),
      ),
      borderStart: style.borderInlineStartWidth,
    };
  });
}

test("UX20: deep-link, chiusura manuale, navigazione, drawer e refresh", async ({
  page,
}, info) => {
  await login(page);
  await page.goto("/carico-merce?tab=pratiche");
  let navigation = await panel(page);
  let warehouse = navigation.getByRole("button", {
    name: "Magazzino",
    exact: true,
  });
  await expect(warehouse).toHaveAttribute("aria-expanded", "true");
  await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute(
    "href",
    "/carico-merce",
  );
  await warehouse.focus();
  await page.keyboard.press("Space");
  await expect(warehouse).toHaveAttribute("aria-expanded", "false");
  await expect(warehouse).toHaveAttribute("data-current", "true");
  await expect(warehouse).not.toHaveAttribute("aria-current");
  const social = navigation.getByRole("button", {
    name: "Centro di Ascolto",
    exact: true,
  });
  await social.focus();
  await page.keyboard.press("Enter");
  await navigation
    .getByRole("link", { name: "Beneficiari", exact: true })
    .click();
  await expect(page).toHaveURL(/\/beneficiari$/);
  if ((page.viewportSize()?.width ?? 0) < 768)
    await expect(
      page.locator('[data-mobile="true"][data-sidebar="sidebar"]'),
    ).not.toBeVisible();
  navigation = await panel(page);
  await expect(
    navigation.getByRole("button", { name: "Magazzino", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    navigation.getByRole("button", { name: "Centro di Ascolto", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute(
    "href",
    "/beneficiari",
  );
  await navigation
    .getByRole("combobox", { name: "Lingua", exact: true })
    .click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(
    navigation.locator('button[data-current="true"]'),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    navigation.locator('button:has([data-nav-group-icon="magazzino"])'),
  ).toHaveAttribute("aria-expanded", "false");
  await navigation
    .getByRole("combobox", { name: "Language", exact: true })
    .click();
  await page.getByRole("option", { name: "Italiano", exact: true }).click();
  await page.goBack();
  navigation = await panel(page);
  await expect(
    navigation.getByRole("button", { name: "Magazzino", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.goForward();
  navigation = await panel(page);
  await expect(
    navigation.getByRole("button", { name: "Centro di Ascolto", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  navigation = await panel(page);
  await expect(
    navigation.locator('button[data-current="true"]'),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    navigation.locator('button[data-current="false"][aria-expanded="true"]'),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("sidebar-corrente.png") });
});

test("UX20: alias, collisione Ruoli e reset al logout dello stesso account", async ({
  page,
}) => {
  await login(page);
  for (const [route, expected] of [
    ["/ruoli-volontari", "/ruoli-volontari"],
    ["/lotti?tab=pratiche", "/carico-merce"],
    ["/report-uds", "/report/uds"],
    ["/mensa/report", "/mensa/report"],
    ["/report/mensa", "/report/mensa"],
  ]) {
    await page.goto(route);
    const navigation = await panel(page);
    await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute(
      "href",
      expected,
    );
    if (route === "/ruoli-volontari")
      await expect(navigation.locator('a[href="/ruoli"]')).not.toHaveAttribute(
        "aria-current",
      );
  }
  await page.goto("/beneficiari");
  const navigation = await panel(page);
  await navigation
    .getByRole("button", { name: "Centro di Ascolto", exact: true })
    .click();
  await navigation
    .getByRole("button", { name: "Generale", exact: true })
    .click();
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(page.getByLabel(/^password$/i)).toBeVisible();
  await login(page);
  const fresh = await panel(page);
  await expect(
    fresh.getByRole("button", { name: "Generale", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    fresh.getByRole("button", { name: "Centro di Ascolto", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("UX20: rotazione conserva gruppi, Escape restituisce focus e desktop chiuso è inerte", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 767, height: 700 });
  await page.goto("/prodotti");
  const opener = page.locator('header [data-sidebar="trigger"]');
  await opener.focus();
  await page.keyboard.press("Enter");
  let navigation = await panel(page);
  await navigation
    .getByRole("button", { name: "Magazzino", exact: true })
    .click();
  await navigation
    .getByRole("button", { name: "Centro di Ascolto", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[data-mobile="true"][data-sidebar="sidebar"]'),
  ).not.toBeVisible();
  await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 768, height: 700 });
  navigation = await panel(page);
  await expect(
    navigation.getByRole("button", { name: "Centro di Ascolto", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    navigation.getByRole("button", { name: "Magazzino", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await opener.click();
  await expect(page.locator('[data-slot="sidebar-container"]')).toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest("[inert]")),
    ),
  ).toBe(false);
  await opener.click();
  await page.setViewportSize({ width: 390, height: 844 });
  navigation = await panel(page);
  await expect(
    navigation.getByRole("button", { name: "Centro di Ascolto", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("UX20: matrice 390/767/768/820/1024/1440, light/dark, RTL e contrasto misurato", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop-1440x900",
    "La matrice completa viene eseguita una sola volta",
  );
  test.setTimeout(180_000);
  await login(page);
  const measurements: unknown[] = [];
  for (const width of [390, 767, 768, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 767 ? 320 : 700 });
    for (const scenario of [
      { lang: "it", dark: false, route: "/carico-merce", side: "left" },
      { lang: "de", dark: true, route: "/carico-merce", side: "left" },
      { lang: "ar", dark: false, route: "/report/mensa", side: "right" },
      { lang: "ar", dark: true, route: "/beneficiari", side: "left" },
      { lang: "ar", dark: false, route: "/carico-merce", side: "right" },
    ]) {
      await page.evaluate(
        (lang) => localStorage.setItem("ms-lang", lang),
        scenario.lang,
      );
      await page.goto(scenario.route);
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        scenario.dark,
      );
      const navigation = await panel(page);
      await expect(navigation).toBeInViewport({ ratio: 1 });
      const active = navigation.locator('a[aria-current="page"]');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveAttribute("href", scenario.route);
      const side =
        width < 768
          ? await navigation.evaluate((el) =>
              Math.round(el.getBoundingClientRect().left) === 0
                ? "left"
                : "right",
            )
          : await page.locator("[data-side]").getAttribute("data-side");
      expect(side).toBe(scenario.side);
      await active.scrollIntoViewIfNeeded();
      await page.keyboard.press("Tab");
      await active.focus();
      // Theme changes animate the background; measure the settled rendered state.
      await active.evaluate(async (element) => {
        const group = element.closest('[data-sidebar="group"]')!;
        await Promise.all(
          group
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished),
        );
      });
      const actual = await contrast(page);
      measurements.push({ width, ...scenario, ...actual });
      expect(actual.text).toBeGreaterThanOrEqual(4.5);
      expect(actual.groupText).toBeGreaterThanOrEqual(4.5);
      expect(actual.indicator).toBeGreaterThanOrEqual(3);
      expect(actual.groupIndicator).toBeGreaterThanOrEqual(3);
      expect(actual.focus).toBeGreaterThanOrEqual(3);
      expect(actual.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(actual.borderStart).toBe("3px");
      expect(
        await active.evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await navigation.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      const footer = navigation.locator('[data-sidebar="footer"]');
      const footerBox = await footer.boundingBox();
      expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height + 1,
      );
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: info.outputPath(
            `sidebar-${width}-${scenario.lang}-${scenario.dark ? "dark" : "light"}.png`,
          ),
        });
    }
  }
  await info.attach("contrasti-sidebar", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});
