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
import { areaGuard } from "../src/middlewares/auth";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createCentro,
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
  "beneficiari.export",
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
    aree: ["analisi", "uds"],
    permessi: [...permessi],
  });
}

function appWithRealAreaGuard(aree: string[], permessi: readonly string[]) {
  return makeScopedApp(
    combinedRouter(),
    {
      id: userId,
      centroAscoltoId: null,
      areaOperativaId: null,
      zonaUdsId: null,
      aree,
      permessi: [...permessi],
    },
    [areaGuard],
  );
}

function appAsPureUds(
  areaOperativaId: number,
  centroAscoltoId: number | null,
  permessi: readonly string[] = [
    "uds.directory.view",
    "beneficiari.manage",
    "beneficiari.view",
  ],
  aree: string[] = ["analisi", "uds"],
) {
  return makeScopedApp(
    combinedRouter(),
    {
      id: userId,
      centroAscoltoId,
      areaOperativaId,
      zonaUdsId: null,
      aree,
      permessi: [...permessi],
    },
    [areaGuard],
  );
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
  it("applica i soli dati minimi e la classificazione età alle nuove persone UDS", async () => {
    const area = await createAreaOperativa(scope);
    const zona = await createZona(scope, area);
    const udsApp = appAs(area, zona.id, ["beneficiari.manage"]);
    const base = {
      nome: "Persona",
      cognome: "Campo",
      sesso: "F",
      areaProvenienza: "Extra-UE",
      uds: true,
    };

    const missingAge = await request(udsApp).post("/beneficiari").send(base);
    expect(missingAge.status).toBe(400);
    expect(missingAge.body.error).toMatch(/seleziona la fascia d'età/i);

    const missingOrigin = await request(udsApp)
      .post("/beneficiari")
      .send({ ...base, areaProvenienza: undefined, fasciaEtaPresunta: "18_29" });
    expect(missingOrigin.status).toBe(400);
    expect(missingOrigin.body.error).toMatch(/Area di provenienza/i);

    const estimated = await request(udsApp)
      .post("/beneficiari")
      .send({ ...base, fasciaEtaPresunta: "18_29" });
    expect(estimated.status).toBe(201);
    scope.beneficiarioIds.push(estimated.body.id);
    expect(estimated.body).toMatchObject({
      uds: true,
      areaOperativaId: area,
      zonaUdsId: zona.id,
      fasciaEtaCorrente: "18_29",
      fasciaEtaOrigine: "presunta",
    });

    const birthDate = await request(udsApp)
      .post("/beneficiari")
      .send({
        ...base,
        nome: "Data",
        dataNascita: "2000-01-01",
      });
    expect(birthDate.status).toBe(201);
    scope.beneficiarioIds.push(birthDate.body.id);
    expect(birthDate.body.fasciaEtaOrigine).toBe("calcolata");

    const birthDateWins = await request(udsApp)
      .post("/beneficiari")
      .send({
        ...base,
        nome: "Precedenza",
        dataNascita: "2000-01-01",
        fasciaEtaPresunta: "65_plus",
      });
    expect(birthDateWins.status).toBe(201);
    scope.beneficiarioIds.push(birthDateWins.body.id);
    expect(birthDateWins.body).toMatchObject({
      fasciaEtaCorrente: birthDate.body.fasciaEtaCorrente,
      fasciaEtaOrigine: "calcolata",
    });

    const notDetermined = await request(udsApp)
      .post("/beneficiari")
      .send({ ...base, fasciaEtaPresunta: "non_determinata" });
    expect(notDetermined.status).toBe(400);

    const socialApp = makeScopedApp(combinedRouter(), {
      id: userId,
      centroAscoltoId: null,
      areaOperativaId: area,
      zonaUdsId: null,
      aree: ["sociale"],
      permessi: ["beneficiari.manage"],
    });
    const social = await request(socialApp).post("/beneficiari").send({
      nome: "Sociale",
      cognome: "Invariato",
      sesso: "M",
      areaProvenienza: "UE",
      uds: false,
    });
    expect(social.status).toBe(201);
    scope.beneficiarioIds.push(social.body.id);
    const enableWithoutAge = await request(udsApp)
      .patch(`/beneficiari/${social.body.id}`)
      .send({ uds: true, versione: social.body.versione });
    expect(enableWithoutAge.status).toBe(400);
    expect(enableWithoutAge.body.error).toMatch(/seleziona la fascia d'età/i);
    const enabledWithAge = await request(udsApp)
      .patch(`/beneficiari/${social.body.id}`)
      .send({
        uds: true,
        zonaUdsId: zona.id,
        fasciaEtaPresunta: "30_64",
        versione: social.body.versione,
      });
    expect(enabledWithAge.status).toBe(200);
    expect(enabledWithAge.body).toMatchObject({
      uds: true,
      fasciaEtaCorrente: "30_64",
    });

  });

  it("espone a un operatore UDS puro solo candidati non-UDS attivi della stessa Area con DTO minimizzato", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centroOperatore = await createCentro(scope, areaA);
    const centroSociale = await createCentro(scope, areaA);
    const candidateId = await createBeneficiario(scope, centroSociale, {
      areaOperativaId: areaA,
    });
    const crossAreaId = await createBeneficiario(scope, null, {
      areaOperativaId: areaB,
    });
    const alreadyUdsId = await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: areaA,
    });
    const inactiveId = await createBeneficiario(scope, null, {
      areaOperativaId: areaA,
    });
    const codiceFiscale = "RSSMRA80A01H501U";
    const telefono = "3339876543";
    await db
      .update(beneficiariTable)
      .set({
        codiceFiscale,
        nome: "Mario",
        cognome: "Riservato",
        soprannome: "Mimmo",
        telefono,
        email: "mario.riservato@example.org",
        dataNascita: "1980-01-01",
        areaProvenienza: "UE",
        residenza: "Via Riservata 1",
        domicilio: "Via Segreta 2",
        noteInterne: "Nota sociale riservata",
      })
      .where(eq(beneficiariTable.id, candidateId));
    await db
      .update(beneficiariTable)
      .set({ nome: "Mario", cognome: "AltraArea" })
      .where(eq(beneficiariTable.id, crossAreaId));
    await db
      .update(beneficiariTable)
      .set({ nome: "Mario", cognome: "GiaUds" })
      .where(eq(beneficiariTable.id, alreadyUdsId));
    await db
      .update(beneficiariTable)
      .set({ nome: "Mario", cognome: "Inattivo", attivo: false })
      .where(eq(beneficiariTable.id, inactiveId));

    const udsOnly = appAsPureUds(areaA, centroOperatore);
    const byName = await request(udsOnly)
      .get("/uds/directory/link-candidates")
      .query({ search: "Mario" });
    expect(byName.status).toBe(200);
    expect(byName.body.map((item: { id: number }) => item.id)).toEqual([
      candidateId,
    ]);
    expect(Object.keys(byName.body[0]).sort()).toEqual(
      [
        "id",
        "codice",
        "nome",
        "cognome",
        "soprannome",
        "fasciaEtaCorrente",
        "versione",
      ].sort(),
    );
    expect(byName.body[0]).toMatchObject({
      id: candidateId,
      nome: "Mario",
      cognome: "Riservato",
      soprannome: "Mimmo",
      fasciaEtaCorrente: "30_64",
      versione: 1,
    });
    for (const forbidden of [
      "codiceFiscale",
      "telefono",
      "email",
      "dataNascita",
      "centroAscoltoId",
      "centroAscoltoNome",
      "domicilio",
      "residenza",
      "note",
      "noteInterne",
    ]) {
      expect(byName.body[0]).not.toHaveProperty(forbidden);
    }

    for (const search of [codiceFiscale, telefono]) {
      const internalMatch = await request(udsOnly)
        .get("/uds/directory/link-candidates")
        .query({ search });
      expect(internalMatch.status).toBe(200);
      expect(internalMatch.body.map((item: { id: number }) => item.id)).toEqual([
        candidateId,
      ]);
      expect(internalMatch.body[0]).not.toHaveProperty("codiceFiscale");
      expect(internalMatch.body[0]).not.toHaveProperty("telefono");
    }

    const normalDirectory = await request(udsOnly)
      .get("/uds/directory")
      .query({ search: "Mario", page: 1, limit: 20 });
    expect(normalDirectory.status).toBe(200);
    expect(
      normalDirectory.body.map((item: { id: number }) => item.id),
    ).toContain(alreadyUdsId);
    expect(
      normalDirectory.body.map((item: { id: number }) => item.id),
    ).not.toContain(candidateId);

    expect(
      (await request(udsOnly).get("/uds/directory/link-candidates")).status,
    ).toBe(400);
    expect(
      (
        await request(udsOnly)
          .get("/uds/directory/link-candidates")
          .query({ search: "M" })
      ).status,
    ).toBe(400);
  });

  it("richiede Area UDS e i due permessi dedicati senza concedere la full duplicate search", async () => {
    const area = await createAreaOperativa(scope);
    const path = "/uds/directory/link-candidates?search=Mario";

    expect(
      (
        await request(
          appAsPureUds(area, null, ["beneficiari.manage"]),
        ).get(path)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          appAsPureUds(area, null, ["uds.directory.view"]),
        ).get(path)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          appAsPureUds(
            area,
            null,
            ["uds.directory.view", "beneficiari.manage"],
            ["sociale"],
          ),
        ).get(path)
      ).status,
    ).toBe(403);

    const udsOnly = appAsPureUds(area, null, [
      "uds.directory.view",
      "beneficiari.manage",
    ]);
    expect((await request(udsOnly).get(path)).status).toBe(200);
    expect(
      (
        await request(udsOnly)
          .get("/beneficiari/cerca-simili")
          .query({ nome: "Mario" })
      ).status,
    ).toBe(403);
  });

  it("scopre il candidato senza aprire il dossier e lo collega sullo stesso id preservando il Centro", async () => {
    const area = await createAreaOperativa(scope);
    const centroOperatore = await createCentro(scope, area);
    const centroSociale = await createCentro(scope, area);
    const candidateId = await createBeneficiario(scope, centroSociale, {
      areaOperativaId: area,
    });
    const [candidate] = await db
      .update(beneficiariTable)
      .set({
        nome: "Lucia",
        cognome: "DaCollegare",
        areaProvenienza: "UE",
        fasciaEtaPresunta: "30_64",
      })
      .where(eq(beneficiariTable.id, candidateId))
      .returning({ codice: beneficiariTable.codice });
    const udsOnly = appAsPureUds(area, centroOperatore);

    const discovery = await request(udsOnly)
      .get("/uds/directory/link-candidates")
      .query({ search: "Lucia" });
    expect(discovery.status).toBe(200);
    expect(discovery.body).toHaveLength(1);
    expect(discovery.body[0].id).toBe(candidateId);

    expect(
      (await request(udsOnly).get(`/beneficiari/${candidateId}`)).status,
    ).toBe(403);

    const linked = await request(udsOnly)
      .patch(`/beneficiari/${candidateId}`)
      .send({ uds: true, versione: discovery.body[0].versione });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({
      id: candidateId,
      uds: true,
      centroAscoltoId: centroSociale,
    });
    const rows = await db
      .select({
        id: beneficiariTable.id,
        uds: beneficiariTable.uds,
        centroAscoltoId: beneficiariTable.centroAscoltoId,
      })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.codice, candidate.codice));
    expect(rows).toEqual([
      {
        id: candidateId,
        uds: true,
        centroAscoltoId: centroSociale,
      },
    ]);
  });

  it("classifica i report UDS attraverso areaGuard reale senza ampliare gli altri report", async () => {
    const udsReports = appWithRealAreaGuard(
      ["analisi", "uds"],
      ["uds.reports.view"],
    );
    for (const path of [
      "/report/uds",
      "/report/uds/interventi-per-mese",
      "/report/filter-options?section=uds",
      "/report/drilldown?section=uds&metric=interventi",
    ]) {
      expect((await request(udsReports).get(path)).status, path).toBe(200);
    }
    for (const path of [
      "/report/mensa",
      "/report/emporio",
      "/report/centro-ascolto",
      "/report/magazzino-logistica",
      "/report/fse-plus/integrato",
    ]) {
      expect((await request(udsReports).get(path)).status, path).toBe(403);
    }
    expect(
      (
        await request(appWithRealAreaGuard(["analisi", "uds"], [])).get(
          "/report/uds",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(appWithRealAreaGuard(["uds"], ["uds.reports.view"])).get(
          "/report/uds",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          appWithRealAreaGuard(["analisi"], ["uds.reports.view"]),
        ).get("/report/uds")
      ).status,
    ).toBe(403);
  });

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

  it("autorizza e audita l'export server-side della sola directory minimizzata", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const zonaA = await createZona(scope, areaA);
    const zonaB = await createZona(scope, areaB);
    const personaA = await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: areaA,
      zonaUdsId: zonaA.id,
    });
    await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: areaB,
      zonaUdsId: zonaB.id,
    });

    const allowed = await request(
      appAs(areaA, null, ["uds.directory.view", "beneficiari.export"]),
    )
      .post("/uds/directory/export")
      .send({ zonaUdsId: zonaA.id, search: "Test" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.map((item: { id: number }) => item.id)).toContain(
      personaA,
    );
    expect(allowed.body).toHaveLength(1);
    expect(Object.keys(allowed.body[0]).sort()).toEqual(
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
    expect(allowed.body[0]).not.toHaveProperty("telefono");
    expect(allowed.body[0]).not.toHaveProperty("codiceFiscale");

    expect(
      (
        await request(appAs(areaA, null, ["uds.directory.view"]))
          .post("/uds/directory/export")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(appAs(areaA, null, ["beneficiari.export"]))
          .post("/uds/directory/export")
          .send({})
      ).status,
    ).toBe(403);

    const [audit] = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(
        and(
          eq(auditConfigurazioniTable.utenteId, userId),
          eq(auditConfigurazioniTable.chiave, "directory:export"),
        ),
      );
    expect(audit.valoreNuovo).toMatchObject({
      tipo: "directory UDS",
      areaOperativaId: areaA,
      zonaUdsId: zonaA.id,
      searchApplied: true,
      recordCount: 1,
    });
    expect(JSON.stringify(audit.valoreNuovo)).not.toMatch(
      /nome|cognome|codiceFiscale|telefono/i,
    );
  });

  it("mantiene accessibile il legacy UDS esplicito senza inventare snapshot", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const persona = await createBeneficiario(scope, null, {
      uds: false,
      areaOperativaId: areaA,
      zonaUdsId: null,
    });
    const fixtureClient = await pool.connect();
    let legacy: number;
    try {
      await fixtureClient.query("BEGIN");
      await fixtureClient.query("SET LOCAL session_replication_role = replica");
      const inserted = await fixtureClient.query<{ id: number }>(
        `
          INSERT INTO interventi (
            beneficiario_id, ambito, area_operativa_id_snapshot,
            zona_uds_id_snapshot, data_intervento, tipo_intervento
          ) VALUES ($1, 'uds', NULL, NULL, '2026-08-19', 'legacy_uds_esplicito')
          RETURNING id
        `,
        [persona],
      );
      legacy = inserted.rows[0].id;
      await fixtureClient.query("COMMIT");
    } catch (error) {
      await fixtureClient.query("ROLLBACK");
      throw error;
    } finally {
      fixtureClient.release();
    }
    scope.interventoIds.push(legacy);
    const [legacyRow] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, legacy));

    const sameArea = appAs(areaA, null, [
      "uds.interventi.view",
      "uds.interventi.note",
      "uds.bisogni.manage",
    ]);
    const history = await request(sameArea).get(
      `/uds/beneficiari/${persona}/interventi`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: legacy,
          areaOperativaIdSnapshot: null,
          zonaUdsIdSnapshot: null,
          territorioStoricoClassificato: false,
        }),
      ]),
    );
    const note = await request(sameArea)
      .patch(`/uds/interventi/${legacy}/nota`)
      .send({
        versione: legacyRow.dataAggiornamento?.toISOString(),
        noteUds: "Nota legacy consentita",
      });
    expect(note.status).toBe(200);
    expect(note.body.areaOperativaIdSnapshot).toBeNull();
    expect(
      (await request(appAs(areaB, null)).get(`/uds/interventi/${legacy}`))
        .status,
    ).toBe(403);
    const [persisted] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, legacy));
    expect(persisted.areaOperativaIdSnapshot).toBeNull();
    expect(persisted.zonaUdsIdSnapshot).toBeNull();
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
          {
            tipo: "azione",
            descrizione: "Accompagnamento",
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
    const need = needs.find((item) => item.descrizione === "Documento")!;
    const secondNeed = needs.find((item) => item.descrizione === "Contatto")!;
    const thirdNeed = needs.find(
      (item) => item.descrizione === "Accompagnamento",
    )!;
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

    const historyBeforeConflict = await db
      .select()
      .from(bisogniPianificatiStoricoTable)
      .where(
        inArray(bisogniPianificatiStoricoTable.bisognoId, [
          need.id,
          secondNeed.id,
          thirdNeed.id,
        ]),
      );
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
            versione: secondNeed.versione,
            stato: "annullato",
          },
          {
            id: thirdNeed.id,
            versione: thirdNeed.versione + 1,
            stato: "completato",
          },
        ],
      });
    expect(nestedConflict.status).toBe(409);
    const needsAfterRollback = await db
      .select()
      .from(bisogniPianificatiTable)
      .where(
        inArray(bisogniPianificatiTable.id, [
          need.id,
          secondNeed.id,
          thirdNeed.id,
        ]),
      );
    const needAfterRollback = needsAfterRollback.find(
      (item) => item.id === need.id,
    );
    expect(needAfterRollback).toMatchObject({
      stato: "pianificato",
      versione: needUpdated.body.versione,
    });
    expect(
      needsAfterRollback.find((item) => item.id === secondNeed.id),
    ).toMatchObject({
      stato: "da_pianificare",
      versione: secondNeed.versione,
    });
    expect(
      needsAfterRollback.find((item) => item.id === thirdNeed.id),
    ).toMatchObject({
      stato: "da_pianificare",
      versione: thirdNeed.versione,
    });
    const historyAfterConflict = await db
      .select()
      .from(bisogniPianificatiStoricoTable)
      .where(
        inArray(bisogniPianificatiStoricoTable.bisognoId, [
          need.id,
          secondNeed.id,
          thirdNeed.id,
        ]),
      );
    expect(historyAfterConflict).toHaveLength(historyBeforeConflict.length);

    const validBatch = await request(app)
      .patch(`/interventi/${created.body.id}`)
      .send({
        versione: rectified.body.versione,
        bisogniPianificati: [
          {
            id: secondNeed.id,
            versione: secondNeed.versione,
            stato: "pianificato",
            dataPrevista: "2026-09-01",
            motivo: "Pianificazione batch",
          },
          {
            id: thirdNeed.id,
            versione: thirdNeed.versione,
            stato: "completato",
            motivo: "Completamento batch",
          },
          {
            tipo: "richiesta",
            descrizione: "Nuova richiesta batch",
            stato: "da_pianificare",
            priorita: "normale",
            motivo: "Creazione batch",
          },
        ],
      });
    expect(validBatch.status).toBe(200);
    const needsAfterValidBatch = await db
      .select()
      .from(bisogniPianificatiTable)
      .where(eq(bisogniPianificatiTable.interventoId, created.body.id));
    expect(
      needsAfterValidBatch.find((item) => item.id === secondNeed.id),
    ).toMatchObject({
      stato: "pianificato",
      dataPrevista: "2026-09-01",
      versione: secondNeed.versione + 1,
    });
    expect(
      needsAfterValidBatch.find((item) => item.id === thirdNeed.id),
    ).toMatchObject({
      stato: "completato",
      versione: thirdNeed.versione + 1,
    });
    const createdInBatch = needsAfterValidBatch.find(
      (item) => item.descrizione === "Nuova richiesta batch",
    );
    expect(createdInBatch).toBeDefined();
    const historyAfterValidBatch = await db
      .select()
      .from(bisogniPianificatiStoricoTable)
      .where(
        inArray(
          bisogniPianificatiStoricoTable.bisognoId,
          needsAfterValidBatch.map((item) => item.id),
        ),
      );
    expect(historyAfterValidBatch).toHaveLength(
      historyBeforeConflict.length + 3,
    );

    const completedNeed = await request(app)
      .patch(`/interventi/${created.body.id}/bisogni-pianificati/${need.id}`)
      .send({
        versione: needUpdated.body.versione,
        stato: "completato",
        motivo: "Completamento",
      });
    expect(completedNeed.status).toBe(200);
    expect(completedNeed.body).toMatchObject({ stato: "completato" });
    expect(completedNeed.body.dataCompletamento).not.toBeNull();

    const reopenedNeed = await request(app)
      .patch(`/interventi/${created.body.id}/bisogni-pianificati/${need.id}`)
      .send({
        versione: completedNeed.body.versione,
        stato: "da_pianificare",
        motivo: "Riapertura",
      });
    expect(reopenedNeed.status).toBe(200);
    expect(reopenedNeed.body).toMatchObject({ stato: "da_pianificare" });
    expect(reopenedNeed.body.dataCompletamento).toBeNull();

    const createdAfterConclusion = await request(app)
      .post(`/interventi/${created.body.id}/bisogni-pianificati`)
      .send({
        tipo: "azione",
        descrizione: "Nuovo bisogno successivo",
        stato: "da_pianificare",
        priorita: "alta",
      });
    expect(createdAfterConclusion.status).toBe(201);

    const history = await request(app).get(
      `/interventi/${created.body.id}/bisogni-pianificati/${need.id}/storico`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(4);
    expect(history.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statoPrecedente: "da_pianificare",
          statoNuovo: "pianificato",
          operatoreId: userId,
          motivo: "Pianificazione",
        }),
      ]),
    );
    expect(history.body.at(-1)).toMatchObject({
      statoPrecedente: "completato",
      statoNuovo: "da_pianificare",
      motivo: "Riapertura",
    });

    await db
      .update(beneficiariTable)
      .set({ zonaUdsId: null, uds: false })
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
  it("rifiuta uds=false finché la Zona non viene rimossa esplicitamente", async () => {
    const area = await createAreaOperativa(scope);
    const zona = await createZona(scope, area);
    const personaId = await createBeneficiario(scope, null, {
      uds: true,
      areaOperativaId: area,
      zonaUdsId: zona.id,
    });
    const [persona] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, personaId));
    const app = appAs(area, null, ["beneficiari.manage"]);

    const rejected = await request(app)
      .patch(`/beneficiari/${personaId}`)
      .send({ uds: false, versione: persona.versione });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/rimuovere esplicitamente.*Zona/i);

    const cleared = await request(app)
      .patch(`/beneficiari/${personaId}`)
      .send({ uds: false, zonaUdsId: null, versione: persona.versione });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ uds: false, zonaUdsId: null });
    expect(cleared.body.versione).toBe(persona.versione + 1);
  });

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
