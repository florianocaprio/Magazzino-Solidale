import { expect, test } from "@playwright/test";
import { bolle } from "../src/lib/i18n/namespaces/bolle";
import { login } from "./helpers";

const languages = ["it", "es", "en", "fr", "de", "ar"] as const;
const supportedProjects = new Set([
  "desktop-1440x900",
  "tablet-portrait-768x1024",
  "tablet-landscape-1024x768",
]);

test("M4A: sei lingue, RTL, viewport tablet, tastiera/tocco e inserimento manuale barcode", async ({
  page,
}, testInfo) => {
  test.skip(
    !supportedProjects.has(testInfo.project.name),
    "Matrice M4A desktop/tablet dedicata",
  );
  await login(page);
  for (const language of languages) {
    await page.evaluate(
      (value) => localStorage.setItem("ms-lang", value),
      language,
    );
    await page.goto("/bolle");
    await expect(
      page.getByRole("heading", { name: bolle[language].title }),
    ).toBeVisible();
    expect(await page.locator("html").getAttribute("lang")).toBe(language);
    expect(await page.locator("html").getAttribute("dir")).toBe(
      language === "ar" ? "rtl" : "ltr",
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `Overflow orizzontale con lingua ${language}`,
    ).toBeLessThanOrEqual(1);
  }

  await page.evaluate(() => localStorage.setItem("ms-lang", "it"));
  await page.goto("/bolle");
  const newButton = page.getByRole("button", { name: /^nuovo$/i });
  const size = await newButton.boundingBox();
  expect(size).not.toBeNull();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  if (testInfo.project.name === "desktop-1440x900") {
    await newButton.focus();
    await page.keyboard.press("Enter");
  } else {
    await newButton.tap();
  }
  const choice = page.getByRole("dialog", {
    name: /nuovo documento operativo/i,
  });
  await expect(choice).toBeVisible();
  await choice.getByRole("button", { name: /nuova bolla/i }).click();
  const create = page.getByRole("dialog", { name: /nuova bolla di consegna/i });
  await expect(create).toBeVisible();
  const manualBarcode = create.getByPlaceholder(
    /scansiona o digita il codice/i,
  );
  await manualBarcode.fill("DEMO-BEN-001");
  await manualBarcode.press("Enter");
  await expect(create).toContainText("Demo 001 Beneficiario");
  await expect
    .poll(async () => {
      const createSize = await create
        .getByRole("button", { name: /crea bolla/i })
        .boundingBox();
      return createSize?.height ?? 0;
    })
    .toBeGreaterThanOrEqual(44);
});
