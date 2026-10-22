import { test, expect } from "@playwright/test";
import { m67aMensaFixture } from "../../api-server/tests/helpers/m67a-mensa-fixture";
import {
  createAreaOperativa,
  createZona,
  createBeneficiario,
  insertIntervento,
  newScope,
} from "../../api-server/tests/scope-helpers";
import { updateModuloAmbiente } from "../../api-server/src/lib/configurazioneAmbiente";
import { pool } from "../../../lib/db/src/index";

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

test("M67-31: two real UDS Area sessions separate minimal directory, territorial dossier and Reporting, then revoke the same session", async ({
  page,
  browser,
}) => {
  const f = await m67aMensaFixture(),
    scope = newScope();
  await updateModuloAmbiente("UDS", true, null);
  const areas = [f.area, await createAreaOperativa(scope)];
  const zones = [
    await createZona(scope, areas[0]),
    await createZona(scope, areas[1]),
  ];
  const actors = [f.users.requester, f.users.receiver];
  const people: Array<{
    id: number;
    nome: string;
    cognome: string;
    codice: string;
  }> = [];
  for (let i = 0; i < 2; i++) {
    await pool.query("update ruoli set aree=$1,permessi=$2 where id=$3", [
      JSON.stringify(["uds", "analisi"]),
      JSON.stringify([
        "uds.directory.view",
        "uds.interventi.view",
        "uds.reports.view",
        "beneficiari.view",
      ]),
      actors[i].roleId,
    ]);
    await pool.query(
      "update utenti set area_operativa_id=$1,zona_uds_id=null,centro_ascolto_id=null where id=$2",
      [areas[i], actors[i].id],
    );
    const id = await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: areas[i],
      zonaUdsId: zones[i].id,
    });
    const person = (
      await pool.query(
        "update beneficiari set cognome=$1,note_interne=$2 where id=$3 returning id,nome,cognome,codice",
        [`SyntheticZone${zones[i].id}`, `PRIVATE-P4-ZONE-${zones[i].id}`, id],
      )
    ).rows[0];
    people.push(person);
    await insertIntervento(scope, {
      beneficiarioId: id,
      ambito: "uds",
      tipoIntervento: `P4 type ${zones[i].id}`,
      dataIntervento: "2026-10-17",
      areaOperativaIdSnapshot: areas[i],
      zonaUdsIdSnapshot: zones[i].id,
    });
  }
  const second = await browser.newContext({
    baseURL: "http://127.0.0.1:19672",
    viewport: page.viewportSize()!,
  });
  try {
    const pages = [page, await second.newPage()];
    for (let i = 0; i < 2; i++) {
      const p = pages[i],
        own = people[i],
        foreign = people[1 - i];
      await p.goto("/login");
      await p.getByLabel(/username|nome utente/i).fill(actors[i].username);
      await p.getByLabel(/^password$/i).fill(actors[i].password);
      await p.getByRole("button", { name: /accedi|login/i }).click();
      await expect(p).not.toHaveURL(/\/login(?:[?#]|$)/);
      expect(await (await p.request.get("/api/auth/me")).json()).toMatchObject({
        areaOperativaId: areas[i],
        zonaUdsId: null,
        centroAscoltoId: null,
      });
      const directoryResponse = p.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/uds/directory",
      );
      await p.goto("/uds/anagrafica");
      const directory = await directoryResponse;
      expect(directory.status()).toBe(200);
      const index = await directory.json();
      expect(index.find((r: { id: number }) => r.id === own.id)).toMatchObject({
        accessoCompleto: true,
      });
      expect(
        index.find((r: { id: number }) => r.id === foreign.id),
      ).toBeUndefined();
      expect(JSON.stringify(index)).not.toContain("PRIVATE-P4-ZONE-");
      await expect(
        p.getByRole("link", { name: own.cognome, exact: true }),
      ).toBeVisible();
      await expect(p.getByText(foreign.cognome, { exact: true })).toHaveCount(0);
      await expect(
        p.getByRole("link", { name: foreign.cognome, exact: true }),
      ).toHaveCount(0);
      const dossier = p.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/beneficiari/${own.id}`,
      );
      await p.getByRole("link", { name: own.cognome, exact: true }).click();
      expect((await dossier).status()).toBe(200);
      await expect(p).toHaveURL(
        new RegExp(`/uds/anagrafica/${own.id}\\?ritorno=`),
      );
      const denied = await p.request.get(`/api/beneficiari/${foreign.id}`);
      expect(denied.status()).toBe(403);
      expect(await denied.text()).not.toContain(
        `PRIVATE-P4-ZONE-${zones[1 - i].id}`,
      );
      const reportResponse = p.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/report/uds",
      );
      await p.goto("/report/uds?da=2026-01-01&a=2026-12-31");
      const report = await reportResponse;
      expect(report.status(), await report.text()).toBe(200);
      const data = await report.json();
      expect(
        data.kpi.find((k: { key: string }) => k.key === "interventi").value,
      ).toBe(1);
      expect(JSON.stringify(data)).not.toContain(zones[1 - i].nome);
      expect(JSON.stringify(data)).not.toContain("PRIVATE-P4-ZONE-");
      await expect(
        p.getByRole("cell", { name: zones[i].nome, exact: true }),
      ).toBeVisible();
      await expect(
        p.getByRole("cell", { name: zones[1 - i].nome, exact: true }),
      ).toHaveCount(0);
    }
    await pool.query(
      "update utenti set area_operativa_id=null,zona_uds_id=null,centro_ascolto_id=null where id=$1",
      [actors[0].id],
    );
    for (const endpoint of [
      "/api/uds/directory",
      `/api/beneficiari/${people[0].id}`,
      "/api/report/uds?da=2026-01-01&a=2026-12-31",
    ]) {
      const denied = await page.request.get(endpoint);
      expect(denied.status(), endpoint + ": " + (await denied.text())).toBe(
        403,
      );
    }
    await page.reload();
    await expect(
      page.getByRole("cell", { name: zones[0].nome, exact: true }),
    ).toHaveCount(0);
  } finally {
    await second.close();
  }
});
