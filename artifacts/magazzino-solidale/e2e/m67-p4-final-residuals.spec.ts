import { test, expect } from "@playwright/test";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import {
  createCentroRec,
  createVolontario,
  createMezzo,
  createBeneficiario,
  insertIntervento,
  insertBolla,
  insertConsegna,
  newScope,
} from "../../api-server/tests/scope-helpers";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import { dataCivileEuropeRome } from "../../api-server/src/lib/interventiWorkflow";
import { pool } from "../../../lib/db/src/index";
import { selectOption } from "./helpers";

test.afterAll(async () => {
  await pool.end();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await info.attach("synthetic-dom", {
      body: await page.locator("body").ariaSnapshot(),
      contentType: "text/plain",
    });
});

test("M67-32: real logistics session edits its calendar slot, rejects stale version and enforces same-session grant revocation", async ({
  page,
}) => {
  const f = await m67aMensaFixture(),
    scope = newScope();
  for (const module of ["LOGISTICA", "VOLONTARI", "MEZZI", "CENTRO_ASCOLTO"])
    await updateModuloAmbiente(module, true, null);
  const centre = await createCentroRec(scope, { areaOperativaId: f.area });
  const volunteer = await createVolontario(scope, centre.id);
  const vehicle = await createMezzo(scope, { centroId: centre.id });
  const code = (
    await pool.query("select codice from mezzi where id=$1", [vehicle])
  ).rows[0].codice;
  const grants = [
    "logistica.turni.view",
    "logistica.turni.manage",
    "logistica.volontari.view",
    "logistica.mezzi.view",
  ];
  await pool.query(
    'update ruoli set aree=\'["logistica","sociale"]\',permessi=$1 where id=$2',
    [JSON.stringify(grants), f.users.requester.roleId],
  );
  await page.goto("/login");
  await page
    .getByLabel(/username|nome utente/i)
    .fill(f.users.requester.username);
  await page.getByLabel(/^password$/i).fill(f.users.requester.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  const today = dataCivileEuropeRome();
  const payload = {
    centroAscoltoId: centre.id,
    data: today,
    fascia: "09-13",
    mezzoId: vehicle,
    volontari: [{ volontarioId: volunteer, ruolo: "Autista sintetico" }],
  };
  const created = await page.request.put("/api/turni", { data: payload });
  expect(created.status(), await created.text()).toBe(200);
  const initial = (
    await pool.query(
      "select id,versione from turni where centro_ascolto_id=$1 and data=$2 and fascia='09-13'",
      [centre.id, today],
    )
  ).rows[0];
  const actor = await page.request.get("/api/auth/me");
  expect(actor.status()).toBe(200);
  expect(await actor.json()).toMatchObject({
    areaOperativaId: f.area,
    centroAscoltoId: null,
  });
  await page.goto("/turni");
  await expect(page.locator("#turni-area")).toBeDisabled();
  await selectOption(page, page.locator("#turni-centro"), centre.nome);
  const slot = page
    .getByRole("tabpanel", { name: "Pianificazione" })
    .getByRole("button")
    .filter({ hasText: code });
  await expect(slot).toHaveCount(1);
  await slot.click();
  const dialog = page.getByRole("dialog", {
    name: "Turno · Mattina (09:00–13:00)",
    exact: true,
  });
  await dialog
    .getByPlaceholder("Ruolo (opzionale)")
    .fill("Ruolo aggiornato P4");
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/turni" &&
      r.request().method() === "PUT",
  );
  await dialog
    .getByRole("button", { name: "Salva turno", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(slot).toContainText("Ruolo aggiornato P4");
  const after = (
    await pool.query(
      "select t.versione,v.ruolo from turni t join turni_volontari v on v.turno_id=t.id where t.id=$1",
      [initial.id],
    )
  ).rows[0];
  expect(after).toEqual({
    versione: initial.versione + 1,
    ruolo: "Ruolo aggiornato P4",
  });
  expect(
    (
      await page.request.put("/api/turni", {
        data: { ...payload, versione: initial.versione },
      })
    ).status(),
  ).toBe(409);
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(grants.filter((g) => g !== "logistica.turni.manage")),
    f.users.requester.roleId,
  ]);
  expect(
    (
      await page.request.put("/api/turni", {
        data: { ...payload, versione: after.versione },
      })
    ).status(),
  ).toBe(403);
  await page.reload();
  await selectOption(page, page.locator("#turni-centro"), centre.nome);
  await expect(slot).toBeDisabled();
  expect(
    (await pool.query("select versione from turni where id=$1", [initial.id]))
      .rows[0].versione,
  ).toBe(after.versione);
});

test("M67-34: all sixteen layer combinations use real scoped APIs, then revoke deliveries in the same session", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const f = await m67aMensaFixture(),
    scope = newScope();
  for (const module of ["CENTRO_ASCOLTO", "BOLLE", "CONSEGNE"])
    await updateModuloAmbiente(module, true, null);
  const centre = await createCentroRec(scope, { areaOperativaId: f.area });
  const grants = [
    "maps.operational",
    "maps.route",
    "sociale.interventi.view",
    "consegne.view",
    "bolle.view",
  ];
  await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [
    JSON.stringify(["sociale", "magazzino"]),
    JSON.stringify(grants),
    f.users.requester.roleId,
  ]);
  await pool.query("update utenti set centro_ascolto_id=$1 where id=$2", [
    centre.id,
    f.users.requester.id,
  ]);
  await pool.query(
    "update centri_di_ascolto set indirizzo='Via Sintetica Maps 1' where id=$1",
    [centre.id],
  );
  await pool.query(
    "update magazzini set centro_ascolto_id=$1,indirizzo='Via Sintetica Maps 2' where id=$2",
    [centre.id, f.origin],
  );
  const beneficiary = await createBeneficiario(scope, centre.id, {
    areaOperativaId: f.area,
  });
  await pool.query(
    "update beneficiari set domicilio='Via Sintetica Maps 3' where id=$1",
    [beneficiary],
  );
  const now = new Date(),
    today = dataCivileEuropeRome(now);
  const intervention = await insertIntervento(scope, {
    beneficiarioId: beneficiary,
    ambito: "sociale",
    areaOperativaIdSnapshot: f.area,
  });
  await pool.query(
    "update interventi set stato='pianificato',sede='Via Sintetica Maps 4',data_ora_pianificata=$1 where id=$2",
    [now, intervention],
  );
  const bolla = await insertBolla(scope, {
    beneficiarioId: beneficiary,
    magazzinoId: f.origin,
    stato: "confermato",
    dataBolla: today,
  });
  await pool.query("update bolle set ritiro_non_effettuato_at=$1 where id=$2", [
    now,
    bolla,
  ]);
  const delivery = await insertConsegna(scope, {
    beneficiarioId: beneficiary,
    magazzinoId: f.origin,
    dataPrevista: today,
    stato: "pianificata",
  });
  await pool.query(
    "update consegne set indirizzo_consegna='Via Sintetica Maps 5' where id=$1",
    [delivery],
  );
  // Only the external tile service is replaced. All business responses are real.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 503, body: "Synthetic offline cartography" }),
  );
  await page.goto("/login");
  await page
    .getByLabel(/username|nome utente/i)
    .fill(f.users.requester.username);
  await page.getByLabel(/^password$/i).fill(f.users.requester.password);
  await page.getByRole("button", { name: /accedi|login/i }).click();
  await expect(page).toHaveURL(/\/$/);
  const layers = [
    ["Interventi sociali pianificati", "sociale/interventi", intervention],
    ["Consegne pacchi", "pacchi/consegne", delivery],
    ["Ritiri non effettuati", "pacchi/ritiri-non-effettuati", bolla],
    ["Punti operativi", "centro/punti-operativi", centre.id],
  ] as const;
  const rows: Array<Array<{ title: string; entityId: number }>> = [];
  for (const [, path, id] of layers) {
    const response = await page.request.get(
      `/api/maps/layers/${path}?da=${today}&a=${today}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const records = await response.json();
    expect(records.some((r: { entityId: number }) => r.entityId === id)).toBe(
      true,
    );
    rows.push(records);
  }
  await page.goto("/maps");
  await page.locator("#maps-da").fill(today);
  await page.locator("#maps-a").fill(today);
  for (let mask = 0; mask < 16; mask++) {
    for (const [index, [label]] of layers.entries()) {
      const toggle = page.getByRole("switch", { name: label, exact: true });
      const enabled = Boolean(mask & (1 << index));
      if ((await toggle.getAttribute("aria-checked")) !== String(enabled))
        await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
    }
    const visible = rows.flatMap((records, index) =>
      mask & (1 << index) ? records : [],
    );
    await expect(page.getByTestId("maps-activity-row")).toHaveCount(
      visible.length,
    );
    for (const record of visible)
      await expect(
        page.getByTestId("maps-activity-row").getByRole("button", {
          name: `Dettagli: ${record.title}`,
          exact: true,
        }),
      ).toHaveCount(1);
  }
  await pool.query("update ruoli set permessi=$1 where id=$2", [
    JSON.stringify(grants.filter((g) => g !== "consegne.view")),
    f.users.requester.roleId,
  ]);
  expect(
    (
      await page.request.get(
        `/api/maps/layers/pacchi/consegne?da=${today}&a=${today}`,
      )
    ).status(),
  ).toBe(403);
  const capabilities = await page.request.get("/api/maps/capabilities");
  expect(capabilities.status()).toBe(200);
  expect(
    (await capabilities.json()).layers.map((l: { code: string }) => l.code),
  ).not.toContain("pacchi.consegne");
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Consegne pacchi", exact: true }),
  ).toHaveCount(0);
  for (const record of rows[1])
    await expect(
      page.getByTestId("maps-activity-row").getByRole("button", {
        name: `Dettagli: ${record.title}`,
        exact: true,
      }),
    ).toHaveCount(0);
});
