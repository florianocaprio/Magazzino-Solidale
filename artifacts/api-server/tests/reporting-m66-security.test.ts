import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  utentiTable,
  ruoliTable,
  menseTable,
  utentiMenseTable,
  mensaAccessiTable,
  mensaPastiTable,
  mensaGiornateServizioTable,
  interventiTable,
  trasferimentiTable,
} from "@workspace/db";
import {
  createAreaOperativa,
  createCentroRec,
  insertTrasferimento,
  createMagazzino,
  createUtente,
  createBeneficiario,
  createZona,
  newScope,
} from "./scope-helpers";
import { httpListeners } from "./helpers/http-listeners";
import { initDbExtensions } from "../src/lib/dbInit";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import {
  prodottiTable,
  beneficiariTable,
  bolleTable,
  creditoSolidaleMovimentiTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  richiesteMagazzinoTable,
  richiesteMagazzinoDocumentiTable,
  auditEventiTable,
} from "@workspace/db";
import {
  createProdotto,
  createLotto,
  insertBolla,
  insertBollaRiga,
} from "./scope-helpers";
import { withReportExecutor } from "../src/lib/reporting/queryContext";
import { rows } from "../src/lib/reporting/sql";
import {
  volontariTable,
  copertureAssicurativeVolontariTable,
  giornateServizioVolontariTable,
} from "@workspace/db";
import { todayRome } from "../src/lib/volontariDomain";

const scope = newScope();
const listeners = httpListeners({ diagnostics: "reporting-m66-security" });
const period = { da: "2026-01-01", a: "2026-01-31" };
type Agent = ReturnType<typeof request.agent>;
let unassigned: Agent,
  canteen: Agent,
  street: Agent,
  admin: Agent,
  social: Agent;
let area: number,
  m1: number,
  m2: number,
  z1: number,
  z2: number,
  streetUser: number,
  canteenUser: number;
const sentinel = `PRIVATE-Z2-${randomUUID()}`;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.REPORTING_TEST_DISPOSABLE_DB !== "verified" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "59666" ||
    url.pathname !== "/m66_dev"
  )
    throw new Error("Requires dedicated M6.6 disposable database");
  await initDbExtensions();
  await ensureAmbienteModuli();
  for (const code of [
    "REPORT",
    "MENSA",
    "UDS",
    "BOLLE",
    "MAGAZZINO_SOLIDALE",
    "CENTRO_ASCOLTO",
    "TRASFERIMENTI",
    "LOTTI",
    "EMPORIO_SOLIDALE",
  ])
    await updateModuloAmbiente(code, true, null);
  area = await createAreaOperativa(scope);
  const { default: app } = await import("../src/app");
  const server = await listeners.open("reporting-m66", () => app);
  async function login(
    aree: string[],
    areaId: number | null,
    zone: number | null = null,
    isAdmin = false,
  ) {
    const [role] = await db
      .insert(ruoliTable)
      .values({
        nome: `R66-${randomUUID()}`,
        aree,
        isAdmin,
        permessi: [
          "mensa.view",
          "mensa.reports.view",
          "uds.view",
          "uds.reports.view",
          "magazzino.fse.view",
        ],
      })
      .returning();
    const id = await createUtente(scope, { ruoloId: role.id });
    const password = `Ephemeral-${randomUUID()}-1!`;
    const [user] = await db
      .update(utentiTable)
      .set({
        passwordHash: await bcrypt.hash(password, 4),
        areaOperativaId: areaId,
        zonaUdsId: zone,
      })
      .where(eq(utentiTable.id, id))
      .returning();
    const agent = request.agent(server);
    expect(
      (
        await agent
          .post("/api/auth/login")
          .send({ username: user.username, password })
      ).status,
    ).toBe(200);
    return { agent, id };
  }
  unassigned = (await login(["analisi", "sociale", "mensa", "uds"], null))
    .agent;
  admin = (
    await login(["analisi", "mensa", "uds", "sociale"], null, null, true)
  ).agent;
  social = (await login(["analisi", "sociale"], area)).agent;
  const op = await login(["analisi", "mensa"], area);
  canteen = op.agent;
  canteenUser = op.id;
  const ids: number[] = [];
  for (let index = 0; index < 2; index++) {
    const warehouse = await createMagazzino(scope, null, {
      areaOperativaId: area,
    });
    const [m] = await db
      .insert(menseTable)
      .values({
        codice: `R66-${randomUUID().slice(0, 8)}`,
        nome: `Mensa sintetica ${index}`,
        areaOperativaId: area,
        magazzinoId: warehouse,
      })
      .returning();
    ids.push(m.id);
    const beneficiary = await createBeneficiario(scope, null, {
      areaOperativaId: area,
    });
    const [access] = await db
      .insert(mensaAccessiTable)
      .values({
        mensaId: m.id,
        beneficiarioId: beneficiary,
        dataOra: new Date("2026-01-15T12:00:00Z"),
        esito: "consentito",
        motivoEsito: "abilitato",
        modalitaAccesso: "manuale",
        tipoServizio: "pranzo",
        operatoreId: canteenUser,
        idempotencyKey: randomUUID(),
      })
      .returning();
    await db.insert(mensaPastiTable).values({
      mensaId: m.id,
      beneficiarioId: beneficiary,
      accessoMensaId: access.id,
      dataServizio: "2026-01-15",
      tipoServizio: "pranzo",
      operatoreId: canteenUser,
      idempotencyKey: randomUUID(),
    });
  }
  [m1, m2] = ids;
  await db
    .insert(utentiMenseTable)
    .values({ utenteId: canteenUser, mensaId: m1, assegnataDa: canteenUser });
  z1 = (await createZona(scope, area)).id;
  z2 = (await createZona(scope, area)).id;
  const streetLogin = await login(["analisi", "uds"], area, z1);
  street = streetLogin.agent;
  streetUser = streetLogin.id;
  const beneficiary = await createBeneficiario(scope, null, {
    areaOperativaId: area,
    zonaUdsId: z1,
    uds: true,
  });
  await db.insert(interventiTable).values([
    {
      beneficiarioId: beneficiary,
      tipoIntervento: "Contatto",
      ambito: "uds",
      dataIntervento: "2026-01-01",
      areaOperativaIdSnapshot: area,
      zonaUdsIdSnapshot: z2,
      noteUds: sentinel,
    },
    {
      beneficiarioId: beneficiary,
      tipoIntervento: "Contatto",
      ambito: "uds",
      dataIntervento: "2026-01-15",
      areaOperativaIdSnapshot: area,
      zonaUdsIdSnapshot: z1,
      noteUds: "Nota lecita",
    },
  ]);
});
afterAll(async () => {
  await listeners.close();
  await pool.end();
});
const value = (
  body: { kpi: Array<{ key: string; value: number }> },
  key: string,
) => body.kpi.find((k) => k.key === key)?.value;

it("SEC-01 ordinary persisted actor without territory cannot read global dashboard or options", async () => {
  expect(
    (await unassigned.get("/api/report/dashboard").query(period)).status,
  ).toBe(403);
  expect(
    (
      await unassigned
        .get("/api/report/filter-options")
        .query({ section: "mensa" })
    ).status,
  ).toBe(403);
  expect(
    (
      await unassigned
        .post("/api/report/prepare")
        .query({ ...period, section: "generale" })
    ).status,
  ).toBe(403);
});
it("SEC-01 explicit administrative global access remains available", async () => {
  expect((await admin.get("/api/report/dashboard").query(period)).status).toBe(
    200,
  );
});
it("Area: report e filtri includono tutte le mense dell’Area", async () => {
  const report = await canteen.get("/api/report/mensa").query(period);
  expect(report.status).toBe(200);
  expect(value(report.body, "pastiErogati")).toBe(2);
  const general = await canteen.get("/api/report/dashboard").query(period);
  expect(general.status).toBe(200);
  expect(value(general.body, "pastiErogati")).toBe(2);
  const options = await canteen
    .get("/api/report/filter-options")
    .query({ section: "mensa" });
  expect(options.status).toBe(200);
  expect(options.body.mense.map((m: { id: number }) => m.id)).toEqual(
    expect.arrayContaining([m1, m2]),
  );
});
it("Area: M2 e il relativo dettaglio sono accessibili", async () => {
  expect(
    (await canteen.get("/api/report/mensa").query({ ...period, mensaId: m2 }))
      .status,
  ).toBe(200);
  expect(
    (
      await canteen.get("/api/report/drilldown").query({
        ...period,
        section: "mensa",
        metric: "pastiErogati",
        mensaId: m2,
      })
    ).status,
  ).toBe(200);
});
it("Area: FSE include i magazzini delle mense dell’Area", async () => {
  const options = await canteen
    .get("/api/report/filter-options")
    .query({ section: "fse-plus" });
  expect(options.status).toBe(200);
  const [own] = await db.select().from(menseTable).where(eq(menseTable.id, m1));
  const [other] = await db
    .select()
    .from(menseTable)
    .where(eq(menseTable.id, m2));
  expect(
    options.body.warehouses.map((row: { id: number }) => row.id),
  ).toContain(own.magazzinoId);
  expect(
    options.body.warehouses.map((row: { id: number }) => row.id),
  ).toContain(other.magazzinoId);
});
it("SEC-03 assigned zone applies without query; first contact remains absolute historical", async () => {
  const result = await street.get("/api/report/uds").query(period);
  expect(result.status).toBe(200);
  expect(value(result.body, "interventi")).toBe(1);
  expect(value(result.body, "primiContatti")).toBe(0);
  expect(
    (await street.get("/api/report/uds").query({ ...period, zonaUdsId: z2 }))
      .status,
  ).toBe(403);
});
it("SEC-04 legacy daily report must not disclose other-zone notes or events", async () => {
  const result = await street
    .get("/api/report/uds/interventi-giornalieri")
    .query(period);
  expect(result.status).toBe(200);
  expect(JSON.stringify(result.body)).not.toContain(sentinel);
  expect(result.body).toHaveLength(1);
  expect(result.body[0].primoIntervento).toBe(false);
});
it("SEC-06 disabled BOLLE denies both dashboard and direct pacchi drilldown", async () => {
  await updateModuloAmbiente("BOLLE", false, null);
  try {
    expect((await social.get("/api/report/pacchi").query(period)).status).toBe(
      403,
    );
    expect(
      (
        await social
          .get("/api/report/drilldown")
          .query({ ...period, section: "pacchi", metric: "pacchiDistribuiti" })
      ).status,
    ).toBe(403);
  } finally {
    await updateModuloAmbiente("BOLLE", true, null);
  }
});
it("Area: assegnazioni storiche ignorate, revoca del ruolo efficace nella stessa sessione", async () => {
  const prepared = await canteen
    .post("/api/report/prepare")
    .query({ ...period, section: "mensa" });
  expect(prepared.status).toBe(200);
  expect(value(prepared.body.report, "pastiErogati")).toBe(2);
  expect(prepared.body.datasetId).toMatch(/^[a-f0-9-]{36}$/);
  expect(prepared.headers["cache-control"]).toContain("no-store");
  await db
    .update(utentiMenseTable)
    .set({ attiva: false, revocataDa: canteenUser, revocataAt: new Date() })
    .where(eq(utentiMenseTable.utenteId, canteenUser));
  expect(
    value(
      (await canteen.get("/api/report/mensa").query(period)).body,
      "pastiErogati",
    ),
  ).toBe(2);
  const [user] = await db
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.id, canteenUser));
  await db
    .update(ruoliTable)
    .set({ aree: ["analisi"] })
    .where(eq(ruoliTable.id, user.ruoloId!));
  const result = await canteen.get("/api/report/mensa").query(period);
  expect(result.status).toBe(403);
  expect(
    (
      await canteen
        .post("/api/report/prepare")
        .query({ ...period, section: "mensa" })
    ).status,
  ).toBe(403);
  await db
    .update(ruoliTable)
    .set({ aree: ["analisi", "mensa"] })
    .where(eq(ruoliTable.id, user.ruoloId!));
});

it("SEC-03/04 UDS identifiers, options, detail and preparation enforce the current zone and PII allowlist", async () => {
  for (const path of [
    "/api/report/uds",
    "/api/report/dashboard",
    "/api/report/drilldown",
    "/api/report/filter-options",
    "/api/report/uds/interventi-giornalieri",
  ]) {
    const denied = await street.get(path).query({
      ...period,
      section: "uds",
      metric: "interventi",
      zonaUdsId: z2,
    });
    expect(denied.status, path).toBe(403);
  }
  expect(
    (
      await street
        .post("/api/report/prepare")
        .query({ ...period, section: "uds", zonaUdsId: z2 })
    ).status,
  ).toBe(403);
  const options = await street
    .get("/api/report/filter-options")
    .query({ section: "uds" });
  expect(options.status).toBe(200);
  expect(options.body.zones.map((z: { id: number }) => z.id)).toEqual([z1]);
  const prepared = await street
    .post("/api/report/prepare")
    .query({ ...period, section: "uds" });
  expect(prepared.status).toBe(200);
  expect(value(prepared.body.report, "interventi")).toBe(1);
  expect(prepared.body.detail).toBeNull();
  expect(JSON.stringify(prepared.body)).not.toContain(sentinel);
  expect(JSON.stringify(prepared.body)).not.toContain("Nota lecita");
  const daily = await street
    .get("/api/report/uds/interventi-giornalieri")
    .query(period);
  expect(daily.status).toBe(200);
  expect(daily.body).toHaveLength(1);
  expect(Object.keys(daily.body[0]).sort()).toEqual(
    [
      "id",
      "beneficiarioId",
      "beneficiarioNome",
      "soprannome",
      "zonaUdsId",
      "zonaNome",
      "dataIntervento",
      "tipoIntervento",
      "descrizione",
      "note",
      "noteUds",
      "operatoreCodice",
      "numeroIntervento",
      "primoIntervento",
    ].sort(),
  );
  expect(daily.body[0]).toMatchObject({
    zonaUdsId: z1,
    noteUds: "Nota lecita",
    primoIntervento: false,
  });
});

it("SEC-07 UDS grant and territory revocations affect the already-open session", async () => {
  const [user] = await db
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.id, streetUser));
  const [role] = await db
    .select()
    .from(ruoliTable)
    .where(eq(ruoliTable.id, user.ruoloId!));
  const read = () =>
    street.post("/api/report/prepare").query({ ...period, section: "uds" });
  expect((await read()).status).toBe(200);
  try {
    await db
      .update(ruoliTable)
      .set({ permessi: role.permessi.filter((p) => p !== "uds.reports.view") })
      .where(eq(ruoliTable.id, role.id));
    expect((await read()).status).toBe(403);
    expect(
      (await street.get("/api/report/uds/interventi-giornalieri").query(period))
        .status,
    ).toBe(403);
    await db
      .update(ruoliTable)
      .set({ permessi: role.permessi })
      .where(eq(ruoliTable.id, role.id));
    expect((await read()).status).toBe(200);
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null, zonaUdsId: null, centroAscoltoId: null })
      .where(eq(utentiTable.id, user.id));
    expect((await read()).status).toBe(403);
    expect(
      (await street.get("/api/report/dashboard").query(period)).status,
    ).toBe(403);
  } finally {
    await db
      .update(ruoliTable)
      .set({ permessi: role.permessi })
      .where(eq(ruoliTable.id, role.id));
    await db
      .update(utentiTable)
      .set({
        areaOperativaId: user.areaOperativaId,
        zonaUdsId: user.zonaUdsId,
        centroAscoltoId: user.centroAscoltoId,
      })
      .where(eq(utentiTable.id, user.id));
  }
});

it.each([
  ["MENSA", "mensa", "pastiErogati"],
  ["UDS", "uds", "interventiUds"],
  ["EMPORIO_SOLIDALE", "emporio", "speseEmporio"],
  ["CENTRO_ASCOLTO", "centro-ascolto", "interventiCentroAscolto"],
] as const)(
  "SEC-06 disabled %s rejects all section surfaces and removes only its general source",
  async (module, section, key) => {
    await updateModuloAmbiente(module, true, null);
    const before = await admin.get("/api/report/dashboard").query(period);
    expect(before.status).toBe(200);
    expect(before.body.kpi.some((k: { key: string }) => k.key === key)).toBe(
      true,
    );
    try {
      await updateModuloAmbiente(module, false, null);
      for (const path of [
        `/api/report/${section}`,
        "/api/report/filter-options",
        "/api/report/drilldown",
      ]) {
        expect(
          (
            await admin
              .get(path)
              .query({ ...period, section, metric: "interventi" })
          ).status,
          path,
        ).toBe(403);
      }
      expect(
        (await admin.post("/api/report/prepare").query({ ...period, section }))
          .status,
      ).toBe(403);
      const general = await admin
        .post("/api/report/prepare")
        .query({ ...period, section: "generale" });
      expect(general.status).toBe(200);
      expect(
        general.body.report.kpi.some((k: { key: string }) => k.key === key),
      ).toBe(false);
      expect(
        value(general.body.report, "personeUnicheComplessive"),
      ).toBeGreaterThanOrEqual(0);
    } finally {
      await updateModuloAmbiente(module, true, null);
    }
  },
);
it("D08 page beyond the last keeps the true authorized total", async () => {
  const result = await street.get("/api/report/drilldown").query({
    ...period,
    section: "uds",
    metric: "interventi",
    page: 200,
    pageSize: 25,
  });
  expect(result.status).toBe(200);
  expect(result.body.rows).toEqual([]);
  expect(result.body.total).toBe(1);
});
it("D08 each transfer state card opens exactly its own canonical group", async () => {
  const origin = await createMagazzino(scope, null, { areaOperativaId: area });
  const destination = await createMagazzino(scope, null, {
    areaOperativaId: area,
  });
  for (const stato of [
    "richiesto",
    "in_transito",
    "rientro_atteso",
    "confermato",
    "annullato",
  ])
    await db.insert(trasferimentiTable).values({
      codice: `R66-${randomUUID().slice(0, 12)}`,
      magazzinoOrigineId: origin,
      magazzinoDestinoId: destination,
      dataRichiesta: "2026-01-15",
      stato,
    });
  const report = await admin
    .get("/api/report/magazzino-logistica")
    .query({ ...period, areaOperativaId: area });
  expect(report.status).toBe(200);
  for (const [key, states] of Object.entries({
    trasferimentiRichiesti: ["richiesto"],
    trasferimentiInTransito: ["in_transito", "rientro_atteso"],
    trasferimentiCompletati: ["confermato"],
  })) {
    const card = report.body.kpi.find(
      (item: { key: string }) => item.key === key,
    );
    const detail = await admin.get("/api/report/drilldown").query({
      ...period,
      areaOperativaId: area,
      section: "magazzino-logistica",
      metric: card.drilldownMetric,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.total).toBe(card.value);
    expect(
      detail.body.rows.map((row: { stato: string }) => row.stato).sort(),
    ).toEqual(states.sort());
  }
});
it("D04 calendar days, dates with meals and registered zero-meal days remain distinct", async () => {
  await db.insert(mensaGiornateServizioTable).values([
    { mensaId: m1, dataServizio: "2026-01-15", tipoServizio: "pranzo" },
    { mensaId: m1, dataServizio: "2026-01-16", tipoServizio: "pranzo" },
    { mensaId: m1, dataServizio: "2026-01-16", tipoServizio: "cena" },
  ]);
  await db
    .update(mensaPastiTable)
    .set({
      sessoSnapshot: "F",
      fasciaEtaSnapshot: "30_64",
      temporaneoSnapshot: true,
    })
    .where(eq(mensaPastiTable.mensaId, m1));
  const [meal] = await db
    .select()
    .from(mensaPastiTable)
    .where(eq(mensaPastiTable.mensaId, m1));
  await db.insert(mensaAccessiTable).values({
    mensaId: m1,
    beneficiarioId: meal.beneficiarioId,
    dataOra: new Date("2026-01-15T18:00:00Z"),
    esito: "negato",
    motivoEsito: "test",
    modalitaAccesso: "manuale",
    tipoServizio: "cena",
    operatoreId: canteenUser,
    idempotencyKey: randomUUID(),
  });
  const response = await admin.post("/api/report/prepare").query({
    ...period,
    section: "mensa",
    mensaId: m1,
    tipoServizio: "pranzo",
  });
  expect(response.status).toBe(200);
  const result = response.body.report;
  expect(value(result, "giorniCalendario")).toBe(31);
  expect(value(result, "giornateServizio")).toBe(1);
  expect(value(result, "giornateMensaServizio")).toBe(2);
  expect(value(result, "mediaPastiMensaServizio")).toBe(0.5);
  expect(value(result, "accessiNegati")).toBe(0);
  expect(value(result, "pastiTemporanei")).toBe(1);
  expect(
    result.kpi.find((k: { key: string }) => k.key === "mediaPastiCalendario"),
  ).toMatchObject({
    numerator: "1",
    denominator: "31",
    presentationDecimals: 2,
    exactValue: "0.03",
  });
  expect(
    result.tables.find((table: { key: string }) => table.key === "sesso").rows,
  ).toEqual([{ sesso: "F", persone: "1", pasti: "1" }]);
  const empty = await admin
    .get("/api/report/mensa")
    .query({ da: "2026-02-01", a: "2026-02-28", mensaId: m1 });
  expect(empty.status).toBe(200);
  expect(
    empty.body.kpi.find(
      (k: { key: string }) => k.key === "mediaPastiMensaServizio",
    ),
  ).toMatchObject({
    value: null,
    exactValue: null,
    availability: "missing",
    denominator: "0",
  });
});

it("D07 real M4 reservation: physical 10, reserved 8, available 2, threshold 5", async () => {
  const warehouse = await createMagazzino(scope, null, {
    areaOperativaId: area,
  });
  const product = await createProdotto(scope, { unitaMisura: "pz" });
  await db
    .update(prodottiTable)
    .set({ scortaMinima: "5" })
    .where(eq(prodottiTable.id, product));
  await createLotto(scope, {
    prodottoId: product,
    magazzinoId: warehouse,
    quantita: 10,
  });
  const beneficiary = await createBeneficiario(scope, null, {
    areaOperativaId: area,
  });
  const bolla = await insertBolla(scope, {
    beneficiarioId: beneficiary,
    magazzinoId: warehouse,
  });
  await insertBollaRiga(scope, {
    bollaId: bolla,
    prodottoId: product,
    quantita: 8,
    unitaMisura: "pz",
  });
  const confirmed = await admin
    .post(`/api/bolle/${bolla}/conferma`)
    .send({ idempotencyKey: randomUUID(), versione: 1 });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  const result = await admin.post("/api/report/prepare").query({
    ...period,
    section: "magazzino-logistica",
    magazzinoId: warehouse,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(
    result.body.report.tables.find(
      (t: { key: string }) => t.key === "disponibilitaCorrente",
    ).rows,
  ).toEqual([
    expect.objectContaining({
      prodottoId: product,
      fisica: "10.000000",
      impegnato: "8.000000",
      disponibile: "2.000000",
      sottoscorta: true,
    }),
  ]);
  expect(value(result.body.report, "coppieSottoscortaDisponibile")).toBe(1);
});

it("D02 last household snapshot stays 4 after the current household changes to 9", async () => {
  const warehouse = await createMagazzino(scope, null, {
    areaOperativaId: area,
  });
  const beneficiary = await createBeneficiario(scope, null, {
    areaOperativaId: area,
  });
  for (const [day, size] of [
    ["2026-01-04", 3],
    ["2026-01-08", 4],
  ] as const) {
    const bolla = await insertBolla(scope, {
      beneficiarioId: beneficiary,
      magazzinoId: warehouse,
      stato: "consegnato",
      dataBolla: day,
    });
    await db
      .update(bolleTable)
      .set({ numeroComponentiNucleoSnapshot: size })
      .where(eq(bolleTable.id, bolla));
  }
  await db
    .update(beneficiariTable)
    .set({ numComponenti: 9 })
    .where(eq(beneficiariTable.id, beneficiary));
  const result = await admin
    .get("/api/report/pacchi")
    .query({ ...period, magazzinoId: warehouse });
  expect(result.status).toBe(200);
  expect(value(result.body, "personeRaggiunte")).toBe(4);
  expect(value(result.body, "nucleiServiti")).toBe(1);
});

it("D05 credit period flows preserve 150 / -100 / +20 and do not invent as-of balance", async () => {
  const localArea = await createAreaOperativa(scope);
  const beneficiary = await createBeneficiario(scope, null, {
    areaOperativaId: localArea,
  });
  for (const [date, type, delta, before, after] of [
    ["2026-01-01", "ricarica", 150, 0, 150],
    ["2026-01-15", "consumo_spesa", -100, 150, 50],
    ["2026-02-01", "restituzione_spesa", 20, 50, 70],
  ] as const)
    await db.insert(creditoSolidaleMovimentiTable).values({
      beneficiarioId: beneficiary,
      areaOperativaId: localArea,
      tipoMovimento: type,
      variazioneCredito: String(delta),
      saldoPrima: String(before),
      saldoDopo: String(after),
      dataMovimento: new Date(`${date}T12:00:00Z`),
    });
  for (const [da, a, expected] of [
    ["2026-01-01", "2026-01-31", ["-100.00", "150.00"]],
    ["2026-02-01", "2026-02-28", ["20.00"]],
  ] as const) {
    const result = await admin
      .get("/api/report/emporio")
      .query({ da, a, areaOperativaId: localArea });
    expect(result.status).toBe(200);
    expect(
      result.body.tables
        .find((t: { key: string }) => t.key === "creditoFlussiPeriodo")
        .rows.map((r: { variazione: string }) => r.variazione)
        .sort(),
    ).toEqual([...expected].sort());
    expect(
      result.body.kpi.find(
        (k: { key: string }) => k.key === "creditoSaldoAsOf",
      ),
    ).toMatchObject({ value: null, exactValue: null, availability: "missing" });
  }
});

it("PDF-09 report executor observes the same PostgreSQL snapshot across a concurrent mutation", async () => {
  const product = await createProdotto(scope);
  await db
    .update(prodottiTable)
    .set({ nome: "snapshot-before" })
    .where(eq(prodottiTable.id, product));
  await db.transaction(
    async (tx) =>
      withReportExecutor(tx, async () => {
        const read = () =>
          rows<{ nome: string }>(
            sql`SELECT nome FROM prodotti WHERE id=${product}`,
          );
        expect((await read())[0].nome).toBe("snapshot-before");
        await db
          .update(prodottiTable)
          .set({ nome: "snapshot-after" })
          .where(eq(prodottiTable.id, product));
        expect((await read())[0].nome).toBe("snapshot-before");
      }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  expect(
    (
      await rows<{ nome: string }>(
        sql`SELECT nome FROM prodotti WHERE id=${product}`,
      )
    )[0].nome,
  ).toBe("snapshot-after");
});

it("PDF-13 prepared row bound rejects 10001 rows instead of silently truncating", async () => {
  await expect(
    db.transaction(
      (tx) =>
        withReportExecutor(tx, () =>
          rows(sql`SELECT generate_series(1,10001) AS id`),
        ),
      { accessMode: "read only" },
    ),
  ).rejects.toMatchObject({ status: 413 });
  expect(
    await db.transaction(
      (tx) =>
        withReportExecutor(tx, () =>
          rows(sql`SELECT generate_series(1,10000) AS id`),
        ),
      { accessMode: "read only" },
    ),
  ).toHaveLength(10000);
});

it("PDF-09 real HTTP prepare keeps stock table and KPI in the same snapshot across a committed change", async () => {
  const localArea = await createAreaOperativa(scope);
  const warehouse = await createMagazzino(scope, null, {
    areaOperativaId: localArea,
  });
  const product = await createProdotto(scope, { unitaMisura: "pz" });
  const lot = await createLotto(scope, {
    prodottoId: product,
    magazzinoId: warehouse,
    quantita: 10,
  });
  // Include an actual multipage-sized dataset, not just a single KPI.
  await pool.query(
    `WITH inserted AS (
      INSERT INTO prodotti(codice,nome,tipo_prodotto,unita_misura)
      SELECT $1||g,'Snapshot product '||g,'alimentare','pz'
      FROM generate_series(1,301) g RETURNING id
    ) INSERT INTO lotti(prodotto_id,magazzino_id,data_carico,quantita_caricata,quantita_residua)
      SELECT id,$2,'2026-01-01',1,1 FROM inserted`,
    [`SNAP-${randomUUID().slice(0, 8)}-`, warehouse],
  );
  const lock = await pool.connect();
  let pending: Promise<request.Response> | undefined;
  try {
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE lotti IN ACCESS EXCLUSIVE MODE");
    pending = admin
      .post("/api/report/prepare")
      .query({
        ...period,
        section: "magazzino-logistica",
        magazzinoId: warehouse,
      })
      .then((r) => r);
    const deadline = Date.now() + 10000;
    let observed = false;
    while (Date.now() < deadline) {
      const waiting = await pool.query(
        "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND NOT l.granted AND l.relation='lotti'::regclass AND a.pid<>pg_backend_pid()",
      );
      if (waiting.rowCount) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(observed, "observable DB barrier before concurrent mutation").toBe(
      true,
    );
    await lock.query("UPDATE lotti SET quantita_residua=9 WHERE id=$1", [lot]);
    await lock.query("COMMIT");
    const result = await pending;
    expect(result.status, result.text).toBe(200);
    const table = result.body.report.tables.find(
      (t: { key: string }) => t.key === "giacenze",
    );
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      magazzinoId: warehouse,
      unitaMisura: "pz",
      quantita: "311.00",
    });
    expect(value(result.body.report, "giacenzaCorrentePezzi")).toBe(311);
    const detail = result.body.report.tables.find(
      (t: { key: string }) => t.key === "disponibilitaCorrente",
    );
    expect(detail.rows).toHaveLength(302);
    expect(
      detail.rows.filter(
        (r: { disponibile: string }) => r.disponibile === "10.000000",
      ),
    ).toHaveLength(1);
    expect(
      detail.rows.filter(
        (r: { disponibile: string }) => r.disponibile === "1.000000",
      ),
    ).toHaveLength(301);
    expect(
      (
        await pool.query(
          "SELECT quantita_residua::text AS quantity FROM lotti WHERE id=$1",
          [lot],
        )
      ).rows,
    ).toEqual([{ quantity: "9.000000" }]);
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
    await pending;
  }
});

it("PDF-13 real prepare rejects the UTF-8 8 MiB bound without returning a truncated report", async () => {
  const localArea = await createAreaOperativa(scope);
  // Exactly 10k rows: the row guard must NOT be the reason for this rejection.
  // 120 four-byte characters respect the real varchar(120) column constraint.
  await pool.query(
    "INSERT INTO magazzini(codice,nome,area_operativa_id) SELECT $1||g,repeat('📦',120),$2 FROM generate_series(1,10000) g",
    [`SZ${localArea}-`, localArea],
  );
  try {
    const direct = await admin
      .get("/api/report/magazzino-logistica")
      .query({ ...period, areaOperativaId: localArea });
    expect(direct.status).toBe(200);
    expect(
      direct.body.tables.find((t: { key: string }) => t.key === "giacenze")
        .rows,
    ).toHaveLength(10000);
    const result = await admin.post("/api/report/prepare").query({
      ...period,
      section: "magazzino-logistica",
      areaOperativaId: localArea,
    });
    expect(result.status, result.text.slice(0, 300)).toBe(413);
    expect(result.text).toContain("8 MiB");
    expect(result.body).not.toHaveProperty("report");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM magazzini WHERE area_operativa_id=$1",
          [localArea],
        )
      ).rows,
    ).toEqual([{ n: 10000 }]);
  } finally {
    await pool.query("DELETE FROM magazzini WHERE area_operativa_id=$1", [
      localArea,
    ]);
  }
}, 120000);

it("Area: FSE include le distribuzioni delle due mense dell’Area senza accesso inventario", async () => {
  const product = await createProdotto(scope);
  for (const mensaId of [m1, m2]) {
    const [m] = await db
      .select()
      .from(menseTable)
      .where(eq(menseTable.id, mensaId));
    const [day] = await db
      .insert(mensaGiornateServizioTable)
      .values({ mensaId, dataServizio: "2026-01-20", tipoServizio: "pranzo" })
      .returning();
    const lottoId = await createLotto(scope, {
      prodottoId: product,
      magazzinoId: m.magazzinoId,
      quantita: 10,
      fsePlus: true,
    });
    const [op] = await db
      .insert(operazioniDistribuzioneMagazzinoTable)
      .values({
        magazzinoId: m.magazzinoId,
        dataDistribuzione: "2026-01-20",
        canaleOperativo: "MENSA",
        dominioOrigine: "MENSA",
        entitaOrigineTipo: "mensa_giornata_servizio",
        entitaOrigineId: day.id,
        areaOperativaIdSnapshot: area,
        territorioClassificazione: "attribuito",
        creatoDa: canteenUser,
        numeroPasti: 1,
      })
      .returning();
    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consumo",
      dataMovimento: "2026-01-20",
      magazzinoId: m.magazzinoId,
      prodottoId: product,
      lottoId,
      quantita: "1",
      quantitaKgLt: "1",
      unitaMisura: "kg",
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      canaleOperativo: "MENSA",
      operazioneDistribuzioneId: op.id,
    });
  }
  await db
    .update(utentiMenseTable)
    .set({ attiva: true, revocataAt: null, revocataDa: null })
    .where(eq(utentiMenseTable.utenteId, canteenUser));
  try {
    const report = await canteen
      .get("/api/report/fse-plus/integrato")
      .query(period);
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(value(report.body, "eventiDistribuzione")).toBe(2);
    // This actor can inspect its distributions, not warehouse-wide inventories.
    expect(
      report.body.kpi.find(
        (k: { key: string }) => k.key === "giacenzaFseCorrentePezzi",
      ),
    ).toMatchObject({ value: null, availability: "missing" });
    const detail = await canteen
      .get("/api/report/drilldown")
      .query({ ...period, section: "fse-plus", metric: "prodottiFse" });
    expect(detail.status).toBe(200);
    expect(detail.body.total).toBe(2);
    // The same live session must lose this source on the detail route too.
    await updateModuloAmbiente("MENSA", false, null);
    const disabledDetail = await canteen
      .get("/api/report/drilldown")
      .query({ ...period, section: "fse-plus", metric: "prodottiFse" });
    expect(disabledDetail.status).toBe(200);
    expect(disabledDetail.body.total).toBe(0);
    expect(disabledDetail.body.rows).toEqual([]);
  } finally {
    await updateModuloAmbiente("MENSA", true, null);
    await db
      .update(utentiMenseTable)
      .set({ attiva: false, revocataAt: new Date(), revocataDa: canteenUser })
      .where(eq(utentiMenseTable.utenteId, canteenUser));
  }
});

it("AC-11 February containing only a reversal has negative distributed net, not ABS", async () => {
  const localArea = await createAreaOperativa(scope);
  const warehouse = await createMagazzino(scope, null, {
    areaOperativaId: localArea,
  });
  const product = await createProdotto(scope, { unitaMisura: "pz" });
  const lot = await createLotto(scope, {
    prodottoId: product,
    magazzinoId: warehouse,
    quantita: 10,
    fsePlus: true,
  });
  const [op] = await db
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values({
      magazzinoId: warehouse,
      dataDistribuzione: "2026-01-20",
      canaleOperativo: "PACCHI",
      dominioOrigine: "TEST_M66",
      entitaOrigineTipo: "documento_sintetico",
      entitaOrigineId: product,
      areaOperativaIdSnapshot: localArea,
      territorioClassificazione: "attribuito",
      creatoDa: canteenUser,
      numeroPacchi: 1,
    })
    .returning();
  const [original] = await db
    .insert(movimentiTable)
    .values({
      tipoMovimento: "scarico",
      tipoDettaglio: "distribuzione",
      dataMovimento: "2026-01-20",
      magazzinoId: warehouse,
      prodottoId: product,
      lottoId: lot,
      quantita: "1",
      quantitaPezzi: "1",
      unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      canaleOperativo: "PACCHI",
      operazioneDistribuzioneId: op.id,
    })
    .returning();
  await db.insert(movimentiTable).values({
    tipoMovimento: "storno",
    tipoDettaglio: "storno",
    dataMovimento: "2026-02-05",
    magazzinoId: warehouse,
    prodottoId: product,
    lottoId: lot,
    quantita: "1",
    quantitaPezzi: "1",
    unitaMisura: "pz",
    fondoOrigine: "FSE_PLUS",
    naturaContabile: "STORNO",
    movimentoOrigineId: original.id,
    canaleOperativo: "PACCHI",
    operazioneDistribuzioneId: op.id,
  });
  const result = await admin
    .get("/api/report/fse-plus/integrato")
    .query({ da: "2026-02-01", a: "2026-02-28", magazzinoId: warehouse });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(
    result.body.kpi.find(
      (k: { key: string }) => k.key === "distribuzioniFseNettePezzi",
    ),
  ).toMatchObject({ value: -1, exactValue: "-1.000000" });
});

it("AC-06/07 current D2 alone supplies the request; receipt date comes from delivery audit without rewriting request", async () => {
  const localArea = await createAreaOperativa(scope);
  const warehouse = await createMagazzino(scope, null, {
    areaOperativaId: localArea,
  });
  const centro = await createCentroRec(scope, { areaOperativaId: localArea });
  const beneficiary = await createBeneficiario(scope, centro.id, {
    areaOperativaId: localArea,
  });
  const [r] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `R66-${randomUUID().slice(0, 20)}`,
      tipoDestinatario: "beneficiario",
      beneficiarioId: beneficiary,
      centroAscoltoId: centro.id,
      areaOperativaId: localArea,
      sorgente: "beneficiario",
      destinatarioNomeSnapshot: "Synthetic private name",
      areaNomeSnapshot: "Synthetic area",
      bisogno: "PRIVATE_NEED_20",
      inviatoDa: canteenUser,
      stato: "presa_in_carico",
      presoInCaricoDa: canteenUser,
      presoInCaricoAt: new Date("2026-01-11T12:00:00Z"),
      presoInCaricoCodiceSnapshot: "SYNTHETIC",
      dataCreazione: new Date("2026-01-10T12:00:00Z"),
    })
    .returning();
  const d1 = await insertBolla(scope, {
    beneficiarioId: beneficiary,
    magazzinoId: warehouse,
    stato: "annullato",
  });
  const d2 = await insertBolla(scope, {
    beneficiarioId: beneficiary,
    magazzinoId: warehouse,
    stato: "consegnato",
  });
  await db.insert(richiesteMagazzinoDocumentiTable).values([
    {
      richiestaId: r.id,
      tipoDocumento: "bolla",
      bollaId: d1,
      corrente: false,
      creatoDa: canteenUser,
      cessatoDa: canteenUser,
      cessatoAt: new Date(),
      eventoCessazione: "annullamento_m4",
      motivoCessazione: "Test sintetico",
    },
    {
      richiestaId: r.id,
      tipoDocumento: "bolla",
      bollaId: d2,
      corrente: true,
      creatoDa: canteenUser,
    },
  ]);
  await db.insert(auditEventiTable).values({
    correlationId: randomUUID(),
    azione: "BOLLA_CONSEGNATA",
    entitaTipo: "bolla",
    entitaId: d2,
    documentoTipo: "bolla",
    documentoId: d2,
    actorType: "user",
    actorUserId: canteenUser,
    actorCodeSnapshot: "SYNTHETIC",
    dataOperativa: "2026-02-03",
  });
  const before = JSON.stringify(
    await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, r.id)),
  );
  const january = await admin.post("/api/report/prepare").query({
    ...period,
    section: "magazzino-logistica",
    areaOperativaId: localArea,
  });
  expect(january.status, JSON.stringify(january.body)).toBe(200);
  expect(value(january.body.report, "richiesteCoorte")).toBe(1);
  expect(value(january.body.report, "richiesteCoorteRicevute")).toBe(1);
  expect(value(january.body.report, "fornitureRicevutePeriodo")).toBe(0);
  const details = january.body.report.tables.find(
    (t: { key: string }) => t.key === "richiesteTop200",
  ).rows;
  expect(details).toHaveLength(1);
  expect(details[0]).toMatchObject({
    stato: "presa_in_carico",
    statoDocumento: "consegnato",
    preferenza: null,
    origineId: warehouse,
    dataRicezione: "2026-02-03",
  });
  expect(JSON.stringify(january.body)).not.toContain("PRIVATE_NEED_20");
  expect(JSON.stringify(january.body)).not.toContain("Synthetic private name");
  const february = await admin
    .get("/api/report/magazzino-logistica")
    .query({ da: "2026-02-01", a: "2026-02-28", areaOperativaId: localArea });
  expect(february.status).toBe(200);
  expect(value(february.body, "fornitureRicevutePeriodo")).toBe(1);
  expect(value(february.body, "richiesteCoorte")).toBe(0);
  expect(
    JSON.stringify(
      await db
        .select()
        .from(richiesteMagazzinoTable)
        .where(eq(richiesteMagazzinoTable.id, r.id)),
    ),
  ).toBe(before);
});

it("AC-06 Mensa preference A is distinct from actual origin B, without interpreting need text", async () => {
  const localArea = await createAreaOperativa(scope);
  const preferred = await createMagazzino(scope, null, {
    areaOperativaId: localArea,
  });
  const actual = await createMagazzino(scope, null, {
    areaOperativaId: localArea,
  });
  const destination = await createMagazzino(scope, null, {
    areaOperativaId: localArea,
  });
  const [m] = await db
    .insert(menseTable)
    .values({
      codice: `R66-${randomUUID().slice(0, 8)}`,
      nome: "Mensa sintetica richiesta",
      areaOperativaId: localArea,
      magazzinoId: destination,
    })
    .returning();
  const [r] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `R66-${randomUUID().slice(0, 20)}`,
      tipoDestinatario: "magazzino",
      magazzinoDestinatarioId: destination,
      mensaId: m.id,
      areaOperativaId: localArea,
      sorgente: "operativa",
      destinatarioNomeSnapshot: "Mensa sintetica",
      areaNomeSnapshot: "Area sintetica",
      bisogno: "20 confezioni",
      inviatoDa: canteenUser,
      magazzinoRichiestoId: preferred,
      magazzinoRichiestoNomeSnapshot: "Preferenza A",
      dataCreazione: new Date("2026-01-10T12:00:00Z"),
    })
    .returning();
  const t = await insertTrasferimento(scope, {
    origineId: actual,
    destinoId: destination,
  });
  await db
    .update(trasferimentiTable)
    .set({ stato: "confermato", dataConfermaRicezione: "2026-01-20" })
    .where(eq(trasferimentiTable.id, t));
  await db.insert(richiesteMagazzinoDocumentiTable).values({
    richiestaId: r.id,
    tipoDocumento: "trasferimento",
    trasferimentoId: t,
    corrente: true,
    creatoDa: canteenUser,
  });
  const result = await admin
    .get("/api/report/mensa")
    .query({ ...period, mensaId: m.id, areaOperativaId: localArea });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(value(result.body, "richiesteCoorteRicevute")).toBe(1);
  expect(
    result.body.tables.find(
      (table: { key: string }) => table.key === "richiesteTop200",
    ).rows,
  ).toEqual([
    expect.objectContaining({
      preferenza: "Preferenza A",
      origineId: actual,
      stato: "inviata",
      dataRicezione: "2026-01-20",
    }),
  ]);
  expect(JSON.stringify(result.body)).not.toContain("20 confezioni");
});

it("SEC-07 revocation during a genuinely blocked preparation prevents delivery of the old snapshot", async () => {
  const [actor] = await db
    .select()
    .from(utentiTable)
    .where(eq(utentiTable.id, canteenUser));
  const lock = await pool.connect();
  let pending: Promise<request.Response> | undefined;
  try {
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE mensa_pasti IN ACCESS EXCLUSIVE MODE");
    pending = canteen
      .post("/api/report/prepare")
      .query({ ...period, section: "mensa", mensaId: m1 })
      .then((response) => response);
    const deadline = Date.now() + 10000;
    let observed = false;
    while (Date.now() < deadline) {
      const wait = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%mensa_pasti%' AND pid<>pg_backend_pid()",
      );
      if (wait.rowCount) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(
      observed,
      "PostgreSQL must observe the in-flight reader; no assumed timing",
    ).toBe(true);
    await db
      .update(utentiTable)
      .set({ areaOperativaId: null })
      .where(eq(utentiTable.id, canteenUser));
    await lock.query("ROLLBACK");
    const response = await pending;
    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty("report");
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
    if (pending) await pending;
    await db
      .update(utentiTable)
      .set({ areaOperativaId: actor.areaOperativaId })
      .where(eq(utentiTable.id, canteenUser));
  }
});

it("PDF-10 preparation of all eight sections is read-only for stock, credit, requests and FSE administration", async () => {
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of [
      "movimenti",
      "lotti",
      "credito_solidale_movimenti",
      "richieste_magazzino",
      "richieste_magazzino_documenti",
      "esportazioni_fse",
      "esportazioni_fse_eventi",
      "riconciliazioni_fse",
      "fse_fascicoli_sociali_snapshot",
      "audit_eventi",
    ]) {
      const { rows } = await pool.query(
        `SELECT count(*)::text AS n,md5(COALESCE(jsonb_agg(t ORDER BY id)::text,'')) AS fingerprint FROM ${table} t`,
      );
      result[table] = rows[0];
    }
    return result;
  };
  const before = await snapshot();
  for (const section of [
    "generale",
    "pacchi",
    "centro-ascolto",
    "emporio",
    "mensa",
    "uds",
    "magazzino-logistica",
    "fse-plus",
  ]) {
    const response = await admin
      .post("/api/report/prepare")
      .query({ ...period, section, areaOperativaId: area });
    expect(
      response.status,
      `${section}: ${JSON.stringify(response.body)}`,
    ).toBe(200);
  }
  expect(await snapshot()).toEqual(before);
});

it("AC-13 registered, administratively active, operational and critical insurance remain distinct", async () => {
  await updateModuloAmbiente("VOLONTARI", true, null);
  const localArea = await createAreaOperativa(scope);
  const centre = await createCentroRec(scope, { areaOperativaId: localArea });
  const query = {
    ...period,
    areaOperativaId: localArea,
    centroAscoltoId: centre.id,
  };
  const before = await admin
    .get("/api/report/magazzino-logistica")
    .query(query);
  expect(before.status).toBe(200);
  const people = await db
    .insert(volontariTable)
    .values([
      {
        nome: "Private active volunteer",
        cognome: "Synthetic",
        ruolo: "volontario",
        centroAscoltoId: centre.id,
        attivo: true,
        statoApprovazione: "approvato",
      },
      {
        nome: "Private suspended volunteer",
        cognome: "Synthetic",
        ruolo: "volontario",
        centroAscoltoId: centre.id,
        attivo: false,
        statoApprovazione: "approvato",
      },
      {
        nome: "Private temporary volunteer",
        cognome: "Synthetic",
        ruolo: "volontario",
        centroAscoltoId: centre.id,
        attivo: true,
        statoApprovazione: "approvato",
        tipoVolontario: "TEMPORANEO",
      },
    ])
    .returning();
  await db.insert(copertureAssicurativeVolontariTable).values([
    {
      volontarioId: people[0].id,
      dataInizio: "2020-01-01",
      dataFine: "2099-12-31",
      tipoOperazione: "NUOVA_COPERTURA",
    },
    {
      volontarioId: people[1].id,
      dataInizio: "2020-01-01",
      dataFine: "2020-12-31",
      tipoOperazione: "NUOVA_COPERTURA",
    },
  ]);
  await db.insert(giornateServizioVolontariTable).values({
    volontarioId: people[2].id,
    dataServizio: todayRome(),
    centroAscoltoId: centre.id,
    stato: "PRESENTE",
    coperturaVerificata: true,
  });
  const after = await admin.get("/api/report/magazzino-logistica").query(query);
  expect(after.status, JSON.stringify(after.body)).toBe(200);
  for (const [key, delta] of [
    ["volontariIscritti", 3],
    ["volontariAttiviAmministrativi", 2],
    ["volontariOperativi", 2],
    ["volontariAssicurazioneCritica", 1],
  ] as const)
    expect(value(after.body, key) - value(before.body, key)).toBe(delta);
  expect(JSON.stringify(after.body)).not.toContain("Private active volunteer");
  expect(after.body.definitions).toContainEqual({
    code: "volunteersCurrent",
    params: { date: todayRome() },
  });
});
