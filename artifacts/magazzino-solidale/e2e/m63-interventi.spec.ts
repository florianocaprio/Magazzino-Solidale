import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { cameraCardCode, useQrCamera } from "./qr-camera";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import {
  db,
  pool,
  areeOperativeTable,
  centriAscoltoTable,
  beneficiariTable,
  tessereBeneficiariTable,
  ruoliTable,
  utentiTable,
  interventiTable,
} from "../../../lib/db/src/index";
const bcrypt = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
)("bcryptjs") as typeof import("../../api-server/node_modules/bcryptjs");
const { eq } = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
)("drizzle-orm") as typeof import("../../../lib/db/node_modules/drizzle-orm");
const xlsx = createRequire(new URL("../package.json", import.meta.url))(
  "xlsx",
) as typeof import("xlsx");

test.beforeAll(() => {
  expect(process.env.M63_DISPOSABLE_DB).toBe("verified");
  expect(new URL(process.env.E2E_DATABASE_URL!).port).toBe("58631");
});
test.afterAll(async () => {
  await pool.end();
});
test("M63 pagine reali, filtri, calendario bounded, dettaglio e revoca", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const suffix = randomUUID().slice(0, 8);
  const [area] = await db
    .insert(areeOperativeTable)
    .values({ nome: `M63 E2E ${suffix}` })
    .returning();
  const [centre] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `M63 E2E ${suffix}`, areaOperativaId: area.id })
    .returning();
  const [beneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `M63E-${suffix}`,
      nome: "Persona",
      cognome: `Sintetica ${suffix}`,
      areaOperativaId: area.id,
      centroAscoltoId: centre.id,
    })
    .returning();
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `M63 E2E ${suffix}`,
      aree: ["sociale"],
      permessi: [
        "beneficiari.view",
        "sociale.interventi.view",
        "sociale.interventi.create",
        "sociale.interventi.update",
        "sociale.interventi.complete",
        "sociale.interventi.cancel",
      ],
    })
    .returning();
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `m63e-${suffix}`,
      nome: "Operatore sintetico",
      passwordHash: await bcrypt.hash(process.env.E2E_PASSWORD!, 4),
      mustChangePassword: false,
      ruoloId: role.id,
      areaOperativaId: area.id,
      centroAscoltoId: centre.id,
    })
    .returning();
  const records = await db
    .insert(interventiTable)
    .values(
      Array.from({ length: 201 }, (_, i) => ({
        beneficiarioId: beneficiary.id,
        operatoreId: user.id,
        tipoIntervento: `M63-${suffix}`,
        ambito: "sociale",
        stato: "pianificato",
        dataOraPianificata: new Date("2030-10-27T10:00:00Z"),
        dataAggiornamento: new Date(),
        note: `nota riservata ${suffix} ${i}`,
      })),
    )
    .returning();
  await page.goto("/login");
  await page.getByLabel(/username|nome utente/i).fill(user.username);
  await page.getByLabel(/^password$/i).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  await page.goto(`/interventi?vista=pianificati&tipo=M63-${suffix}`);
  const nav = page.getByRole("navigation", { name: "Pagine Interventi" });
  await expect(nav).toContainText("201 risultati");
  const first = page.locator(`[data-intervento-id="${records[0].id}"]:visible`);
  await expect(first).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /^esporta$/i }).click();
  await page.getByRole("menuitem", { name: /excel/i }).click();
  const file = await downloaded;
  const workbook = xlsx.read(await readFile((await file.path())!));
  expect(
    xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]),
  ).toHaveLength(201);
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /^esporta$/i }).click();
  await page.getByRole("menuitem", { name: /pdf/i }).click();
  const pdf = await readFile((await (await pdfDownload).path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  // jsPDF uses uncompressed text streams here: verify every exported row,
  // not only that a PDF download was offered or the first page was fetched.
  expect(
    pdf.toString("latin1").match(new RegExp(`\\(M63-${suffix}\\) Tj`, "g")),
  ).toHaveLength(201);
  await nav.getByRole("button", { name: "Successiva" }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await expect(first).toHaveCount(0);
  await expect(
    page.locator(`[data-intervento-id="${records[50].id}"]:visible`),
  ).toBeVisible();
  await page
    .getByPlaceholder("Cerca nome, cognome o codice beneficiario")
    .fill("non-esiste");
  await expect(nav).toContainText("0 risultati");
  await expect(page).not.toHaveURL(/pagina=2/);
  await page.goto(
    `/interventi?vista=pianificati&tipo=M63-${suffix}&modo=calendario&mese=2030-10&giorno=2030-10-27`,
  );
  await expect(page.getByRole("status")).toContainText(
    "solo la pagina corrente",
  );
  await expect(nav).toContainText("201 risultati");

  const [otherCentre] = await db
    .insert(centriAscoltoTable)
    .values({
      nome: `M63 secondo Centro ${suffix}`,
      areaOperativaId: area.id,
    })
    .returning();
  const [cardHolder] = await db
    .insert(beneficiariTable)
    .values({
      codice: `M63-CARTA-${suffix}`,
      nome: "Persona",
      cognome: `Tessera ${suffix}`,
      areaOperativaId: area.id,
      centroAscoltoId: otherCentre.id,
    })
    .returning();
  const [card] = await db
    .insert(tessereBeneficiariTable)
    .values({
      beneficiarioId: cardHolder.id,
      codice: cameraCardCode(testInfo),
    })
    .returning();
  await updateModuloAmbiente("BARCODE", true, null);
  await useQrCamera(page, card.codice);
  await page.goto("/interventi");
  await page.getByRole("button", { name: "Nuovo intervento" }).click();
  await page
    .getByRole("menuitem", { name: "Pianifica nuovo intervento" })
    .click();
  const form = page.getByRole("dialog", { name: "Intervento pianificato" });
  const center = form.getByRole("combobox", { name: "Centro di Ascolto" });
  await center.click();
  await page.getByRole("option", { name: centre.nome, exact: true }).click();
  const code = form.getByLabel("Codice tessera");
  await code.fill(card.codice);
  await code.press("Enter");
  await expect(form.getByRole("status")).toContainText(
    "Tessera valida non trovata",
  );
  await center.click();
  await page
    .getByRole("option", { name: otherCentre.nome, exact: true })
    .click();
  const person = form.getByRole("combobox", { name: "Beneficiario" });
  await person.click();
  await expect(
    page.getByRole("option", { name: new RegExp(cardHolder.codice) }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: new RegExp(beneficiary.codice) }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await code.fill(card.codice);
  await form.getByRole("button", { name: "Cerca tessera" }).click();
  await expect(person).toContainText(cardHolder.cognome);
  const cameraLookup = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/interventi/beneficiari/tessera") &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Scansiona", exact: true }).click();
  expect((await cameraLookup).status()).toBe(200);
  await expect(person).toContainText(cardHolder.cognome);
  const site = form.getByRole("combobox", { name: "Sede", exact: true });
  await expect(site).toContainText(area.nome);
  await site.click();
  await page
    .getByRole("option", { name: otherCentre.nome, exact: true })
    .click();
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/interventi") &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Salva", exact: true }).click();
  const createdResponse = await creation;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  expect(created).toMatchObject({
    beneficiarioId: cardHolder.id,
    operatoreId: user.id,
    sede: otherCentre.nome,
  });
  const detail = page.getByRole("dialog", { name: /dettaglio intervento/i });
  await detail.getByRole("button", { name: "Avvia intervento" }).click();
  const conclude = detail.getByRole("button", {
    name: "Concludi",
    exact: true,
  });
  await expect(conclude).toBeDisabled();
  await detail
    .getByRole("checkbox", {
      name: "Confermo la conclusione di questo intervento",
    })
    .check();
  await expect(conclude).toBeEnabled();
  await conclude.click();
  await expect(
    detail.getByRole("button", { name: "Salva", exact: true }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: /^Conclusi/ }).click();
  await page.locator(`[data-intervento-id="${created.id}"]:visible`).click();
  const note = detail.getByPlaceholder("Note", { exact: true });
  await note.fill("Nota integrata dopo la conclusione");
  await detail.getByRole("button", { name: "Salva", exact: true }).click();
  await expect
    .poll(async () => {
      const [saved] = await db
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, created.id));
      return { stato: saved.stato, note: saved.note };
    })
    .toEqual({ stato: "concluso", note: "Nota integrata dopo la conclusione" });

  await page.goto(
    `/interventi?vista=pianificati&tipo=M63-${suffix}&interventoId=${records[0].id}`,
  );
  const sheet = page.getByRole("dialog", { name: /dettaglio intervento/i });
  await expect(sheet.getByPlaceholder("Note", { exact: true })).toHaveValue(
    `nota riservata ${suffix} 0`,
  );
  await db
    .update(utentiTable)
    .set({ areaOperativaId: null, centroAscoltoId: null })
    .where(eq(utentiTable.id, user.id));
  // A revocation is discovered by a real canonical read, not by assuming that
  // focus invalidates a still-fresh (30s) query or that offline bytes vanish.
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  const denial = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/interventi/${records[1].id}`) &&
      response.request().method() === "GET",
  );
  await page.locator(`[data-intervento-id="${records[1].id}"]:visible`).click();
  expect((await denial).status()).toBe(403);
  await expect(page.getByRole("alert")).toContainText(
    "Accesso all'Intervento non più disponibile",
  );
  await expect(sheet).toHaveCount(0);
  await expect(page.locator("[data-intervento-id]")).toHaveCount(0);
});
