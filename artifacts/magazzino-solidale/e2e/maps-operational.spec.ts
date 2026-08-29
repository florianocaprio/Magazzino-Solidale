import { expect, test } from "@playwright/test";
import { assertViewportSafe, login } from "./helpers";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("MAPS carica tile e marker, conserva la lista in errore e recupera al retry", async ({
  page,
  viewport,
}) => {
  let tileFailure = true;

  await page.route("**/api/maps/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/maps/capabilities") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          operational: true,
          layers: [
            {
              code: "pacchi.consegne",
              domain: "pacchi",
              label: "Consegne a domicilio",
              routeSupported: false,
            },
          ],
        }),
      });
      return;
    }
    if (pathname === "/api/maps/layers/pacchi/consegne") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "pacchi.consegna:e2e",
            layer: "pacchi.consegne",
            entityType: "consegna",
            entityId: 901,
            title: "Consegna E2E MAPS",
            subtitle: "Mattina",
            status: "pianificata",
            address: "Via Test 1, Roma",
            date: "2026-08-29",
            actions: ["open"],
            latitude: 41.9028,
            longitude: 12.4964,
            locationStatus: "resolved",
          },
        ]),
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.route("https://tile.openstreetmap.org/**", async (route) => {
    if (tileFailure) {
      await route.fulfill({ status: 500, body: "tile unavailable" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "cache-control": "no-store" },
      body: transparentPng,
    });
  });

  await login(page);
  await page.goto("/maps");

  const map = page.getByLabel("Mappa operativa OpenStreetMap");
  await expect(map).toBeVisible();
  await expect(map).toHaveClass(/leaflet-touch-drag/);
  await expect(map).toHaveClass(/leaflet-touch-zoom/);
  await expect(page.getByTestId("maps-tile-error")).toBeVisible({
    timeout: 12_000,
  });
  const visibleMarker = page.locator(".maps-leaflet-marker").first();
  await expect(visibleMarker).toBeVisible();
  const markerBox = await visibleMarker.boundingBox();
  expect(markerBox?.width).toBeGreaterThanOrEqual(44);
  expect(markerBox?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId("maps-activity-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Riprova cartografia" }),
  ).toBeVisible();

  tileFailure = false;
  await page.getByRole("button", { name: "Riprova cartografia" }).click();
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
  await expect(page.getByTestId("maps-tile-error")).toBeHidden();
  await expect(page.getByText("© OpenStreetMap contributors")).toBeVisible();
  await expect(page.locator("#maps-da")).toBeVisible();
  await expect(page.locator("#maps-a")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(1);

  const mapBox = await map.boundingBox();
  expect(mapBox).not.toBeNull();
  expect(mapBox!.x).toBeGreaterThanOrEqual(0);
  expect(mapBox!.x + mapBox!.width).toBeLessThanOrEqual(
    (viewport?.width ?? 0) + 1,
  );
  await assertViewportSafe(page);

  const activityRow = page.getByTestId("maps-activity-row");
  await activityRow.scrollIntoViewIfNeeded();
  const scrollBeforeSelection = await page.evaluate(() => window.scrollY);
  await activityRow
    .getByRole("button", { name: /Dettagli: Consegna E2E MAPS/ })
    .click();
  const detailSheet = page.getByRole("dialog");
  await expect(detailSheet).toContainText("Consegna E2E MAPS");
  await expect(detailSheet).toBeVisible();
  await expect
    .poll(() =>
      detailSheet.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const topmost = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return topmost != null && element.contains(topmost);
      }),
    )
    .toBe(true);
  const scrollAfterSelection = await page.evaluate(() => window.scrollY);
  expect(
    Math.abs(scrollAfterSelection - scrollBeforeSelection),
  ).toBeLessThanOrEqual(1);
  await assertViewportSafe(page);
  await page.getByRole("button", { name: "Close" }).click();

  await visibleMarker.click();
  await expect(page.getByRole("dialog")).toContainText("Via Test 1, Roma");
  await page.getByRole("button", { name: "Close" }).click();
  await assertViewportSafe(page);
});
