import { expect, type Locator, type Page } from "@playwright/test";

const username = process.env.E2E_USERNAME ?? "sadmin";
const password = process.env.E2E_PASSWORD;

export async function login(page: Page) {
  if (!password) throw new Error("E2E_PASSWORD is required");
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

export async function assertViewportSafe(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const undersizedControls = await page
    .locator(
      'button:visible, [role="button"]:visible, [role="switch"]:visible, [role="menuitem"]:visible, [role="option"]:visible, a[data-operational-action]:visible',
    )
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const element = control as HTMLElement;
          return !(
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true" ||
            element.closest("[inert]")
          );
        })
        .map((control) => {
          const element = control as HTMLElement;
          const rect = element.getBoundingClientRect();
          return {
            route: window.location.pathname,
            role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
            label:
              element.getAttribute("aria-label") ??
              element.getAttribute("title") ??
              element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100),
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          };
        })
        .filter(({ width, height }) => width < 44 || height < 44),
    );
  expect(undersizedControls).toEqual([]);
}

export async function selectOption(
  page: Page,
  trigger: Locator,
  option: string | RegExp,
) {
  await trigger.click();
  await page
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
}
