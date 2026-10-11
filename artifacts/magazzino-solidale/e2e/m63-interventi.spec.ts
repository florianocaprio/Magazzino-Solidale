import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  db,
  pool,
  areeOperativeTable,
  centriAscoltoTable,
  beneficiariTable,
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
}) => {
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
  await expect(page).toHaveURL(/\/$/);
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
