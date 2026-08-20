/* @vitest-environment node */

import { Router } from "express";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  bisogniPianificatiStoricoTable,
  bisogniPianificatiTable,
  db,
  interventiTable,
  pool,
  zoneUdsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import beneficiariRouter from "../src/routes/beneficiari";
import interventiRouter from "../src/routes/interventi";
import reportIntegratoRouter from "../src/routes/report-integrato";
import reportRouter from "../src/routes/report";
import udsRouter from "../src/routes/uds";
import zoneUdsRouter from "../src/routes/zone-uds";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createUtente,
  createZona,
  insertIntervento,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

const UDS_PERMISSIONS = [
  "uds.directory.view",
  "uds.interventi.view",
  "uds.interventi.create",
  "uds.interventi.update",
  "uds.interventi.note",
  "uds.bisogni.manage",
  "uds.reports.view",
  "beneficiari.view",
  "beneficiari.manage",
] as const;

let scope: SeedScope;
let bootScope: SeedScope;
let userId: number;

function combinedRouter() {
  const router = Router();
  router.use(udsRouter);
  router.use(beneficiariRouter);
  router.use(interventiRouter);
  router.use(reportIntegratoRouter);
  router.use(reportRouter);
  router.use(zoneUdsRouter);
  return router;
}

function appAs(
  areaOperativaId: number | null,
  zonaUdsId: number | null,
  permessi: readonly string[] = UDS_PERMISSIONS,
) {
  return makeScopedApp(combinedRouter(), {
    id: userId,
    centroAscoltoId: null,
    areaOperativaId,
    zonaUdsId,
    aree: ["uds"],
    permessi: [...permessi],
  });
}

beforeAll(async () => {
  bootScope = newScope();
  userId = await createUtente(bootScope, {});
  await updateModuloAmbiente("UDS", true, null);
});

beforeEach(() => {
  scope = newScope();
});

afterEach(async () => {
  const needs = await db
    .select({ id: bisogniPianificatiTable.id })
    .from(bisogniPianificatiTable)
    .where(
      scope.interventoIds.length > 0
        ? inArray(bisogniPianificatiTable.interventoId, scope.interventoIds)
        : eq(bisogniPianificatiTable.id, -1),
    );
  if (needs.length > 0) {
    const ids = needs.map((row) => row.id);
    await db
      .delete(bisogniPianificatiStoricoTable)
      .where(inArray(bisogniPianificatiStoricoTable.bisognoId, ids));
    await db
      .delete(bisogniPianificatiTable)
      .where(inArray(bisogniPianificatiTable.id, ids));
  }
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, userId));
  await cleanup(scope);
});

afterAll(async () => {
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, userId));
  await cleanup(bootScope);
  await pool.end();
});

describe("UDS hardening territoriale e storico", () => {
  it("consente cross-Zona minimizzato nella stessa Area e nega sempre l'altra Area", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const zonaA1 = await createZona(scope, areaA);
    const zonaA2 = await createZona(scope, areaA);
    const zonaB = await createZona(scope, areaB);
    const personaA2 = await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: areaA,
      zonaUdsId: zonaA2.id,
    });
    const personaB = await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: areaB,
      zonaUdsId: zonaB.id,
    });
    const storicoA2 = await insertIntervento(scope, {
      beneficiarioId: personaA2,
      ambito: "uds",
      areaOperativaIdSnapshot: areaA,
      zonaUdsIdSnapshot: zonaA2.id,
      dataIntervento: "2026-08-20",
      tipoIntervento: "ascolto",
    });

    const appA1 = appAs(areaA, zonaA1.id);
    const directory = await request(appA1)
      .get("/uds/directory")
      .query({ search: "Test", page: 1, limit: 100 });
    expect(directory.status).toBe(200);
    const row = directory.body.find(
      (item: { id: number }) => item.id === personaA2,
    );
    expect(row).toBeDefined();
    expect(
      directory.body.some((item: { id: number }) => item.id === personaB),
    ).toBe(false);
    expect(Number(directory.headers["x-total-count"])).toBe(
      directory.body.length,
    );
    expect(Object.keys(row).sort()).toEqual(
      [
        "accessoCompleto",
        "canale",
        "codice",
        "cognome",
        "fasciaEtaCorrente",
        "id",
        "nome",
        "soprannome",
        "zonaUdsId",
        "zonaUdsNome",
      ].sort(),
    );
    expect(row.accessoCompleto).toBe(false);
    expect(row).not.toHaveProperty("telefono");
    expect(row).not.toHaveProperty("codiceFiscale");
    expect(row).not.toHaveProperty("dataNascita");

    expect((await request(appA1).get(`/beneficiari/${personaA2}`)).status).toBe(
      403,
    );
    const history = await request(appA1).get(
      `/uds/beneficiari/${personaA2}/interventi`,
    );
    expect(history.status).toBe(200);
    expect(history.body.map((item: { id: number }) => item.id)).toContain(
      storicoA2,
    );
    expect(
      (await request(appA1).get(`/uds/beneficiari/${personaB}/interventi`))
        .status,
    ).toBe(403);

    const directoryOnly = appAs(areaA, zonaA1.id, ["uds.directory.view"]);
    expect(
      (
        await request(directoryOnly).get(
          `/uds/beneficiari/${personaA2}/interventi`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(directoryOnly).post("/uds/interventi").send({
          beneficiarioId: personaA2,
          tipoIntervento: "ascolto",
        })
      ).status,
    ).toBe(403);

    const created = await request(appA1)
      .post("/uds/interventi")
      .send({
        beneficiarioId: personaA2,
        tipoIntervento: "contatto_strada",
        descrizione: "Incontro",
        bisogniPianificati: [
          {
            tipo: "azione",
            descrizione: "Richiamare",
            stato: "da_pianificare",
            priorita: "alta",
          },
        ],
      });
    expect(created.status).toBe(201);
    scope.interventoIds.push(created.body.id);
    expect(created.body).toMatchObject({
      beneficiarioId: personaA2,
      operatoreId: userId,
      stato: "concluso",
      ambito: "uds",
      areaOperativaIdSnapshot: areaA,
      zonaUdsIdSnapshot: zonaA2.id,
    });

    const appB = appAs(areaB, zonaB.id);
    expect(
      (await request(appB).get(`/uds/interventi/${created.body.id}`)).status,
    ).toBe(403);
    expect(
      (
        await request(appA1).post("/uds/interventi").send({
          beneficiarioId: personaB,
          tipoIntervento: "ascolto",
        })
      ).status,
    ).toBe(403);

    const noDirectoryPermission = await request(appAs(areaA, zonaA1.id, []))
      .get("/uds/directory")
      .query({ page: 1, limit: 20 });
    expect(noDirectoryPermission.status).toBe(403);
    const noReportPermission = await request(appAs(areaA, zonaA1.id, []))
      .get("/report/uds/interventi-per-mese")
      .query({ da: "2026-01-01", a: "2026-12-31" });
    expect(noReportPermission.status).toBe(403);
    expect(
      (
        await request(appAs(areaA, zonaA1.id, []))
          .get("/report/uds")
          .query({ da: "2026-01-01", a: "2026-12-31" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(appAs(areaA, zonaA1.id, []))
          .get("/report/filter-options")
          .query({ section: "uds" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(appAs(areaA, zonaA1.id, []))
          .get("/report/drilldown")
          .query({ section: "uds", metric: "interventi" })
      ).status,
    ).toBe(403);
    const richDuplicateSearch = await request(
      appAs(areaA, zonaA1.id, ["beneficiari.duplicates.search"]),
    )
      .get("/beneficiari/cerca-simili")
      .query({ search: "Test" });
    expect(richDuplicateSearch.status).toBe(403);
  });

  it("mantiene snapshot, terminalità, nota/rettifica auditata e Bisogni versionati", async () => {
    const area = await createAreaOperativa(scope);
    const zonaStorica = await createZona(scope, area);
    const zonaNuova = await createZona(scope, area);
    const persona = await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: area,
      zonaUdsId: zonaStorica.id,
    });
    const app = appAs(area, zonaNuova.id);
    const created = await request(app)
      .post("/uds/interventi")
      .send({
        beneficiarioId: persona,
        tipoIntervento: "ascolto",
        bisogniPianificati: [
          {
            tipo: "richiesta",
            descrizione: "Documento",
            stato: "da_pianificare",
            priorita: "normale",
          },
          {
            tipo: "azione",
            descrizione: "Contatto",
            stato: "da_pianificare",
            priorita: "normale",
          },
        ],
      });
    expect(created.status).toBe(201);
    scope.interventoIds.push(created.body.id);

    const genericBypass = await request(app)
      .patch(`/interventi/${created.body.id}`)
      .send({
        versione: created.body.versione,
        descrizione: "Riscrittura non consentita",
      });
    expect(genericBypass.status).toBe(409);

    const firstNote = await request(app)
      .patch(`/uds/interventi/${created.body.id}/nota`)
      .send({ versione: created.body.versione, noteUds: "Nota operativa" });
    expect(firstNote.status).toBe(200);
    const staleNote = await request(app)
      .patch(`/uds/interventi/${created.body.id}/nota`)
      .send({ versione: created.body.versione, noteUds: "Nota concorrente" });
    expect(staleNote.status).toBe(409);

    const rectified = await request(app)
      .patch(`/uds/interventi/${created.body.id}/rettifica`)
      .send({
        versione: firstNote.body.versione,
        motivo: "Correzione refuso",
        descrizione: "Descrizione rettificata",
      });
    expect(rectified.status).toBe(200);
    expect(rectified.body).toMatchObject({
      stato: "concluso",
      areaOperativaIdSnapshot: area,
      zonaUdsIdSnapshot: zonaStorica.id,
    });

    const needs = await db
      .select()
      .from(bisogniPianificatiTable)
      .where(eq(bisogniPianificatiTable.interventoId, created.body.id));
    const [need, secondNeed] = needs;
    const needUpdated = await request(app)
      .patch(`/interventi/${created.body.id}/bisogni-pianificati/${need.id}`)
      .send({
        versione: need.versione,
        stato: "pianificato",
        dataPrevista: "2026-08-30",
        motivo: "Pianificazione",
      });
    expect(needUpdated.status).toBe(200);
    expect(needUpdated.body.versione).toBe(need.versione + 1);
    const staleNeed = await request(app)
      .patch(`/interventi/${created.body.id}/bisogni-pianificati/${need.id}`)
      .send({ versione: need.versione, stato: "annullato" });
    expect(staleNeed.status).toBe(409);

    const nestedConflict = await request(app)
      .patch(`/interventi/${created.body.id}`)
      .send({
        versione: rectified.body.versione,
        bisogniPianificati: [
          {
            id: need.id,
            versione: needUpdated.body.versione,
            stato: "completato",
          },
          {
            id: secondNeed.id,
            versione: secondNeed.versione + 1,
            stato: "annullato",
          },
        ],
      });
    expect(nestedConflict.status).toBe(409);
    const [needAfterRollback] = await db
      .select()
      .from(bisogniPianificatiTable)
      .where(eq(bisogniPianificatiTable.id, need.id));
    expect(needAfterRollback).toMatchObject({
      stato: "pianificato",
      versione: needUpdated.body.versione,
    });

    const history = await request(app).get(
      `/interventi/${created.body.id}/bisogni-pianificati/${need.id}/storico`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.at(-1)).toMatchObject({
      statoPrecedente: "da_pianificare",
      statoNuovo: "pianificato",
      operatoreId: userId,
      motivo: "Pianificazione",
    });

    await db
      .update(beneficiariTable)
      .set({ zonaUdsId: zonaNuova.id, uds: false })
      .where(eq(beneficiariTable.id, persona));
    const report = await request(app)
      .get("/report/uds/interventi-per-zona")
      .query({ da: "2026-01-01", a: "2026-12-31" });
    expect(report.status).toBe(200);
    expect(
      report.body.find(
        (item: { zonaId: number }) => item.zonaId === zonaStorica.id,
      )?.totInterventi,
    ).toBe(1);
    expect(
      report.body.find(
        (item: { zonaId: number }) => item.zonaId === zonaNuova.id,
      ),
    ).toBeUndefined();
    const currentPeople = await request(app).get(
      "/report/uds/persone-per-zona",
    );
    expect(currentPeople.status).toBe(200);
    expect(
      currentPeople.body.find(
        (item: { zonaId: number }) => item.zonaId === zonaStorica.id,
      ),
    ).toBeUndefined();

    const legacy = await insertIntervento(scope, {
      beneficiarioId: persona,
      ambito: null,
      dataIntervento: "2026-08-21",
      tipoIntervento: "legacy_ambiguo",
    });
    expect(legacy).toBeGreaterThan(0);
    const types = await request(app)
      .get("/report/uds/interventi-per-tipo")
      .query({ da: "2026-01-01", a: "2026-12-31" });
    expect(
      types.body.find(
        (item: { tipo: string }) => item.tipo === "legacy_ambiguo",
      ),
    ).toBeUndefined();

    const audit = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(
        and(
          eq(auditConfigurazioniTable.utenteId, userId),
          eq(auditConfigurazioniTable.chiave, `intervento:${created.body.id}`),
        ),
      );
    expect(audit.map((item) => item.azione)).toEqual(
      expect.arrayContaining(["creazione", "nota", "rettifica"]),
    );
  });
});

describe("Zone UDS lifecycle", () => {
  it("normalizza unicità, rende l'Area immutabile e usa locking/soft deactivate", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const admin = makeScopedApp(combinedRouter(), {
      id: userId,
      centroAscoltoId: null,
      areaOperativaId: null,
      aree: ["amministrazione", "uds"],
      permessi: [],
      isAdmin: true,
    });
    const created = await request(admin).post("/zone-uds").send({
      areaOperativaId: areaA,
      nome: "  Zona Centrale  ",
      attivo: true,
    });
    expect(created.status).toBe(201);
    scope.zonaIds.push(created.body.id);
    expect(created.body).toMatchObject({ nome: "Zona Centrale", versione: 1 });

    const duplicate = await request(admin).post("/zone-uds").send({
      areaOperativaId: areaA,
      nome: "zona centrale",
      attivo: true,
    });
    expect(duplicate.status).toBe(409);

    const immutable = await request(admin)
      .patch(`/zone-uds/${created.body.id}`)
      .send({ areaOperativaId: areaB, versione: created.body.versione });
    expect(immutable.status).toBe(409);

    const updated = await request(admin)
      .patch(`/zone-uds/${created.body.id}`)
      .send({ note: "Aggiornata", versione: created.body.versione });
    expect(updated.status).toBe(200);
    expect(updated.body.versione).toBe(2);
    const stale = await request(admin)
      .patch(`/zone-uds/${created.body.id}`)
      .send({ note: "Concorrente", versione: created.body.versione });
    expect(stale.status).toBe(409);

    const deactivated = await request(admin)
      .delete(`/zone-uds/${created.body.id}`)
      .send({ versione: updated.body.versione });
    expect(deactivated.status).toBe(204);
    const [persisted] = await db
      .select()
      .from(zoneUdsTable)
      .where(eq(zoneUdsTable.id, created.body.id));
    expect(persisted.attivo).toBe(false);
    const inactiveAssignment = await request(admin).post("/beneficiari").send({
      nome: "Zona",
      cognome: "Inattiva",
      sesso: "M",
      uds: true,
      areaOperativaId: areaA,
      zonaUdsId: created.body.id,
    });
    expect(inactiveAssignment.status).toBe(400);
    expect((await request(admin).get("/zone-uds")).body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.body.id }),
      ]),
    );
    expect(
      (await request(admin).get("/zone-uds").query({ includiInattive: true }))
        .body,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.body.id }),
      ]),
    );
    const audit = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(eq(auditConfigurazioniTable.chiave, `zona:${created.body.id}`));
    expect(audit.map((item) => item.azione)).toEqual(
      expect.arrayContaining(["creazione", "modifica", "disattivazione"]),
    );
  });
});
