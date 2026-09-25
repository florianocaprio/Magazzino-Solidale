import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("UX-TAB — URL, contenuto, cronologia e refresh restano sincronizzati", async ({
  page,
}) => {
  await login(page);

  const tabs = page.getByRole("navigation", {
    name: "Sezioni di Carico Merce",
  });
  const carichi = tabs.getByRole("link", { name: "Carichi" });
  const raccolte = tabs.getByRole("link", { name: "Raccolte / Attività" });
  const lotti = tabs.getByRole("link", { name: "Lotti fisici" });
  const carichiContent = page.getByRole("heading", {
    name: "Carico Merce",
    exact: true,
  });
  const raccolteContent = page.getByText(
    "Raccolte operative e attività: il saldo è derivato dai lotti fisici, non modificabile qui.",
  );
  const lottiContent = page.getByText(
    "Partite fisiche reali originate dai carichi di magazzino. La vista è consultiva.",
  );

  await page.goto("/carico-merce");
  await expect(carichi).toHaveAttribute("aria-current", "page");
  await expect(carichiContent).toBeVisible();

  await raccolte.click();
  await expect(page).toHaveURL(/\/carico-merce\?tab=raccolte$/);
  await expect(raccolte).toHaveAttribute("aria-current", "page");
  await expect(raccolteContent).toBeVisible();
  await expect(carichiContent).toHaveCount(0);

  await lotti.click();
  await expect(page).toHaveURL(/\/carico-merce\?tab=lotti$/);
  await expect(lotti).toHaveAttribute("aria-current", "page");
  await expect(lottiContent).toBeVisible();
  await expect(raccolteContent).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/carico-merce\?tab=raccolte$/);
  await expect(raccolte).toHaveAttribute("aria-current", "page");
  await expect(raccolteContent).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/carico-merce\?tab=lotti$/);
  await expect(lotti).toHaveAttribute("aria-current", "page");
  await expect(lottiContent).toBeVisible();

  await page.reload();
  await expect(lotti).toHaveAttribute("aria-current", "page");
  await expect(lottiContent).toBeVisible();

  await carichi.click();
  await expect(page).toHaveURL(/\/carico-merce\?tab=carichi$/);
  await expect(carichi).toHaveAttribute("aria-current", "page");
  await expect(carichiContent).toBeVisible();
  await page.reload();
  await expect(carichi).toHaveAttribute("aria-current", "page");
  await expect(carichiContent).toBeVisible();

  await page.goto("/carico-merce?tab=raccolte");
  await expect(raccolte).toHaveAttribute("aria-current", "page");
  await expect(raccolteContent).toBeVisible();
  await page.reload();
  await expect(raccolteContent).toBeVisible();

  await page.goto("/carico-merce?tab=lotti");
  await expect(lotti).toHaveAttribute("aria-current", "page");
  await expect(lottiContent).toBeVisible();

  await page.goto("/carico-merce?tab=xyz");
  await expect(page).toHaveURL(/\/carico-merce\?tab=xyz$/);
  await expect(carichi).toHaveAttribute("aria-current", "page");
  await expect(carichiContent).toBeVisible();
});
