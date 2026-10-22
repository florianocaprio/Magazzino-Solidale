/* @vitest-environment node */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import bolleRouter from "../src/routes/bolle";
import consegneRouter from "../src/routes/consegne";
import interventiRouter from "../src/routes/interventi";
import reportRouter from "../src/routes/report";
import reportIntegratoRouter from "../src/routes/report-integrato";
import {
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import {
  cleanup,
  createBeneficiario,
  createAreaOperativa,
  createCentro,
  createCentroRec,
  createMagazzino,
  createZona,
  insertBolla,
  insertConsegna,
  insertIntervento,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";
import { createPersistedSocialActor } from "./persisted-social-actor";
import { persistedSessionApp } from "./helpers/persisted-session-app";

const MODULI_TEST = [
  "CENTRO_ASCOLTO",
  "UDS",
  "REPORT",
  "MAGAZZINO_SOLIDALE",
  "BOLLE",
  "CONSEGNE",
] as const;

let scope: SeedScope;
const statiOriginali = new Map<string, boolean>();

async function setModulo(
  codice: (typeof MODULI_TEST)[number],
  attivo: boolean,
) {
  const result = await updateModuloAmbiente(codice, attivo, null);
  if ("error" in result) throw new Error(result.error);
}

async function abilitaModuliTest() {
  await Promise.all(MODULI_TEST.map((codice) => setModulo(codice, true)));
}

beforeAll(async () => {
  const moduli = await listModuliFunzionali();
  for (const codice of MODULI_TEST) {
    statiOriginali.set(
      codice,
      moduli.find((modulo) => modulo.codice === codice)?.attivo ?? true,
    );
  }
});

beforeEach(async () => {
  scope = newScope();
  await abilitaModuliTest();
});

afterEach(async () => {
  await cleanup(scope);
  await abilitaModuliTest();
});

afterAll(async () => {
  for (const codice of MODULI_TEST) {
    await setModulo(codice, statiOriginali.get(codice) ?? true);
  }
  await pool.end();
});

describe("prerequisiti combinati sulle route reali", () => {
  it("applica Centro di Ascolto e UDS all'ambito reale degli interventi", async () => {
    const areaOperativaId = await createAreaOperativa(scope);
    const centroId = (await createCentroRec(scope, { areaOperativaId })).id;
    const zona = await createZona(scope, areaOperativaId);
    const actor = await createPersistedSocialActor({
      areaOperativaId,
      centroAscoltoId: centroId,
      aree: ["sociale", "uds"],
      permessi: [
        "sociale.interventi.view",
        "sociale.interventi.create",
        "uds.interventi.view",
        "uds.interventi.create",
      ],
    });
    scope.utenteIds.push(actor.id);
    scope.ruoloIds.push(actor.ruoloId);
    const socialeId = await createBeneficiario(scope, centroId, {
      areaOperativaId,
    });
    const udsId = await createBeneficiario(scope, centroId, {
      areaOperativaId,
      zonaUdsId: zona.id,
      uds: true,
    });
    const app = makeScopedApp(interventiRouter, actor);
    const sociale = await request(app).post("/interventi").send({
      beneficiarioId: socialeId,
      tipoIntervento: "test-modulo-sociale",
      ambito: "sociale",
      stato: "da_pianificare",
    });
    if (sociale.status === 201) scope.interventoIds.push(sociale.body.id);
    const uds = await request(app).post("/interventi").send({
      beneficiarioId: udsId,
      tipoIntervento: "test-modulo-uds",
      ambito: "uds",
      stato: "da_pianificare",
    });
    if (uds.status === 201) scope.interventoIds.push(uds.body.id);
    expect(sociale.status).toBe(201);
    expect(uds.status).toBe(201);
    const legacyId = await insertIntervento(scope, {
      beneficiarioId: udsId,
      tipoIntervento: "test-modulo-legacy",
    });

    await setModulo("CENTRO_ASCOLTO", false);
    expect(
      (await request(app).get("/interventi").query({ ambito: "sociale" }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app).post("/interventi").send({
          beneficiarioId: socialeId,
          tipoIntervento: "test-sociale-disabilitato",
          ambito: "sociale",
          stato: "da_pianificare",
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/interventi/${sociale.body.id}`)).status,
    ).toBe(403);
    expect((await request(app).get(`/interventi/${legacyId}`)).status).toBe(
      403,
    );
    const listaUds = await request(app)
      .get("/interventi")
      .query({ ambito: "uds", includiStorici: true });
    expect(listaUds.status).toBe(200);
    expect(listaUds.body.map((row: { id: number }) => row.id)).toContain(
      uds.body.id,
    );
    expect(listaUds.body.map((row: { id: number }) => row.id)).not.toContain(
      legacyId,
    );

    await setModulo("CENTRO_ASCOLTO", true);
    await setModulo("UDS", false);
    expect(
      (await request(app).get(`/interventi/${sociale.body.id}`)).status,
    ).toBe(200);
    expect((await request(app).get(`/interventi/${legacyId}`)).status).toBe(
      200,
    );
    expect(
      (await request(app).get("/interventi").query({ ambito: "uds" })).status,
    ).toBe(403);
    expect(
      (
        await request(app).post("/interventi").send({
          beneficiarioId: udsId,
          tipoIntervento: "test-uds-disabilitato",
          ambito: "uds",
          stato: "da_pianificare",
        })
      ).status,
    ).toBe(403);
    expect((await request(app).get(`/interventi/${uds.body.id}`)).status).toBe(
      403,
    );

    await setModulo("UDS", true);
    expect(
      (await request(app).get(`/interventi/${sociale.body.id}`)).status,
    ).toBe(200);
    expect((await request(app).get(`/interventi/${uds.body.id}`)).status).toBe(
      200,
    );
    expect((await request(app).get(`/interventi/${legacyId}`)).status).toBe(
      200,
    );
  });

  it("separa il report stock dal Centro di Ascolto e da UDS", async () => {
    const app = makeScopedApp(reportRouter, {
      id: 0,
      centroAscoltoId: null,
      areaOperativaId: await createAreaOperativa(scope),
    });

    await setModulo("CENTRO_ASCOLTO", false);

    expect(
      (await request(app).get("/report/giacenze-per-magazzino")).status,
    ).toBe(200);
    expect(
      (await request(app).get("/report/uds/interventi-per-mese")).status,
    ).toBe(200);

    await setModulo("CENTRO_ASCOLTO", true);
    await setModulo("UDS", false);

    expect(
      (await request(app).get("/report/giacenze-per-magazzino")).status,
    ).toBe(200);
    expect(
      (await request(app).get("/report/uds/interventi-per-mese")).status,
    ).toBe(403);

    await setModulo("UDS", true);
    await setModulo("REPORT", false);

    expect(
      (await request(app).get("/report/giacenze-per-magazzino")).status,
    ).toBe(403);
    expect(
      (await request(app).get("/report/uds/interventi-per-mese")).status,
    ).toBe(403);
  });

  it("mantiene adapter e report FSE integrato disponibili senza modulo Centro", async () => {
    const user = {
      id: 0,
      centroAscoltoId: null,
      areaOperativaId: await createAreaOperativa(scope),
      aree: ["analisi", "magazzino"],
      permessi: ["magazzino.fse.view"],
    };
    const legacyApp = makeScopedApp(reportRouter, user);
    const integratedApp = makeScopedApp(reportIntegratoRouter, user);
    await setModulo("CENTRO_ASCOLTO", false);

    const [legacy, integrated] = await Promise.all([
      request(legacyApp).get("/report/fse-plus?anno=2026"),
      request(integratedApp).get(
        "/report/fse-plus/integrato?da=2026-01-01&a=2026-12-31",
      ),
    ]);
    expect(legacy.status).toBe(200);
    expect(integrated.status).toBe(200);
    expect(legacy.body.reportingModelVersion).toBe(
      integrated.body.reportingModelVersion,
    );
    expect(legacy.body.pesoTotaleKg).toBe(
      integrated.body.kpi.find(
        (item: { key: string }) => item.key === "kgCalcolabili",
      )?.value ?? null,
    );

    const deniedPermission = makeScopedApp(reportRouter, {
      ...user,
      permessi: [],
    });
    const deniedArea = makeScopedApp(reportRouter, {
      ...user,
      aree: ["analisi"],
    });
    expect(
      (await request(deniedPermission).get("/report/fse-plus?anno=2026"))
        .status,
    ).toBe(403);
    expect(
      (await request(deniedArea).get("/report/fse-plus?anno=2026")).status,
    ).toBe(403);
  });

  it("richiede Magazzino Solidale e Bolle senza rendere indisponibili i dati", async () => {
    const centroId = await createCentro(scope);
    const magazzinoId = await createMagazzino(scope, centroId);
    const beneficiarioId = await createBeneficiario(scope, centroId);
    const bollaId = await insertBolla(scope, {
      beneficiarioId,
      magazzinoId,
    });
    const app = makeScopedApp(bolleRouter, {
      id: 0,
      centroAscoltoId: null,
      areaOperativaId: null,
    });

    await setModulo("MAGAZZINO_SOLIDALE", false);
    expect((await request(app).get(`/bolle/${bollaId}`)).status).toBe(403);

    await setModulo("MAGAZZINO_SOLIDALE", true);
    const riabilitata = await request(app).get(`/bolle/${bollaId}`);
    expect(riabilitata.status).toBe(200);
    expect(riabilitata.body.id).toBe(bollaId);

    await setModulo("BOLLE", false);
    expect((await request(app).get(`/bolle/${bollaId}`)).status).toBe(403);
  });

  it("richiede Centro di Ascolto e Consegne senza rendere indisponibili i dati", async () => {
    const areaOperativaId = await createAreaOperativa(scope);
    const centroId = (await createCentroRec(scope, { areaOperativaId })).id;
    const magazzinoId = await createMagazzino(scope, centroId, {
      areaOperativaId,
    });
    const beneficiarioId = await createBeneficiario(scope, centroId, {
      areaOperativaId,
    });
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId,
      magazzinoId,
    });
    const centre = (
      await pool.query(
        "select area_operativa_id from centri_di_ascolto where id=$1",
        [centroId],
      )
    ).rows[0];
    const actor = await createPersistedSocialActor({
      areaOperativaId: centre.area_operativa_id,
      centroAscoltoId: centroId,
      aree: ["sociale"],
      permessi: ["consegne.view"],
    });
    scope.utenteIds.push(actor.id);
    scope.ruoloIds.push(actor.ruoloId);
    const app = persistedSessionApp(consegneRouter, actor.id);

    await setModulo("CENTRO_ASCOLTO", false);
    expect((await request(app).get(`/consegne/${consegnaId}`)).status).toBe(
      403,
    );

    await setModulo("CENTRO_ASCOLTO", true);
    const riabilitata = await request(app).get(`/consegne/${consegnaId}`);
    expect(riabilitata.status).toBe(200);
    expect(riabilitata.body.id).toBe(consegnaId);

    await setModulo("CONSEGNE", false);
    expect((await request(app).get(`/consegne/${consegnaId}`)).status).toBe(
      403,
    );
  });
});
