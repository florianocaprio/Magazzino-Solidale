import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  db,
  magazziniTable,
  lottiTable,
  movimentiTable,
  mensaAbilitazioniTable,
  mensaAccessiTable,
  mensaAutorizzazioniTemporaneeTable,
  mensaEccezioniTable,
  mensaConsumiStorniTable,
  mensaConsumiTable,
  mensaGiornateServizioTable,
  mensaPastiTable,
  menseTable,
  pool,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
  tessereBeneficiariTable,
  trasferimentoRigheTable,
  trasferimentiTable,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import mensaRouter, {
  activeEligibility,
  riepilogoAbilitazioneMensa,
} from "../src/routes/mensa";
import beneficiariRouter from "../src/routes/beneficiari";
import trasferimentiRouter from "../src/routes/trasferimenti";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { MENSA_PERMISSIONS } from "../src/lib/permissions";
import {
  dataServizioMensa,
  stessoGiornoServizioMensa,
} from "../src/lib/mensaWorkflow";
import { aggregatiConsumiMensa } from "../src/lib/mensaService";
import { areaGuard } from "../src/middlewares/auth";
import { initDbExtensions } from "../src/lib/dbInit";

const ids = {
  users: [] as number[],
  areeOperative: [] as number[],
  centers: [] as number[],
  zones: [] as number[],
  warehouses: [] as number[],
  beneficiaries: [] as number[],
  canteens: [] as number[],
  transfers: [] as number[],
  products: [] as number[],
  lots: [] as number[],
  consumptions: [] as number[],
  issues: [] as number[],
};
const rnd = () => Math.random().toString(36).slice(2, 9);

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function makeApp(
  fixture: Fixture,
  permissions: string[] = MENSA_PERMISSIONS.map((item) => item.key),
  scope: {
    areaOperativaId?: number | null;
    centroAscoltoId?: number | null;
    zonaUdsId?: number | null;
    aree?: string[];
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: fixture.userId,
      areaOperativaId: "areaOperativaId" in scope ? (scope.areaOperativaId ?? null) : fixture.romeId,
      centroAscoltoId:
        "centroAscoltoId" in scope ? (scope.centroAscoltoId ?? null) : null,
      zonaUdsId: "zonaUdsId" in scope ? (scope.zonaUdsId ?? null) : null,
      isAdmin: false,
      isSuperAdmin: false,
      aree: scope.aree ?? ["mensa", "sociale"],
      permessi: permissions,
      mustChangePassword: false,
    } as NonNullable<typeof req.user>;
    next();
  });
  app.use(areaGuard);
  app.use(beneficiariRouter);
  app.use(mensaRouter);
  app.use(trasferimentiRouter);
  return app;
}

async function createFixture() {
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `mensa_${rnd()}`,
      passwordHash: "x",
      nome: "Operatore Mensa",
    })
    .returning({ id: utentiTable.id });
  ids.users.push(user.id);
  const [rome] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Roma ${rnd()}` })
    .returning({ id: areeOperativeTable.id });
  const [milan] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Milano ${rnd()}` })
    .returning({ id: areeOperativeTable.id });
  ids.areeOperative.push(rome.id, milan.id);
  const warehouses = await db
    .insert(magazziniTable)
    .values([
      {
        codice: `MR1-${rnd()}`,
        nome: "Mensa Roma A",
        areaOperativaId: rome.id,
        tipoMagazzino: "mensa",
      },
      {
        codice: `MR2-${rnd()}`,
        nome: "Mensa Roma B",
        areaOperativaId: rome.id,
        tipoMagazzino: "mensa",
      },
      {
        codice: `MM1-${rnd()}`,
        nome: "Mensa Milano",
        areaOperativaId: milan.id,
        tipoMagazzino: "mensa",
      },
    ])
    .returning({ id: magazziniTable.id });
  ids.warehouses.push(...warehouses.map((row) => row.id));
  const canteens = await db
    .insert(menseTable)
    .values([
      {
        codice: `M-A-${rnd()}`,
        nome: "Roma A",
        areaOperativaId: rome.id,
        magazzinoId: warehouses[0].id,
        createdBy: user.id,
      },
      {
        codice: `M-B-${rnd()}`,
        nome: "Roma B",
        areaOperativaId: rome.id,
        magazzinoId: warehouses[1].id,
        createdBy: user.id,
      },
      {
        codice: `M-M-${rnd()}`,
        nome: "Milano",
        areaOperativaId: milan.id,
        magazzinoId: warehouses[2].id,
        createdBy: user.id,
      },
    ])
    .returning({ id: menseTable.id });
  ids.canteens.push(...canteens.map((row) => row.id));
  const [beneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      nome: "Mario",
      cognome: "Rossi",
      areaOperativaId: rome.id,
      attivo: true,
      restrizioniAlimentari: "senza glutine",
      allergie: "arachidi",
      noteInterne: "NOTA SOCIALE RISERVATA",
      creditoSolidaleSaldo: "999.00",
    })
    .returning({ id: beneficiariTable.id });
  const [milanBeneficiary] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-MI-${rnd()}`,
      nome: "Persona",
      cognome: "Milano",
      areaOperativaId: milan.id,
      attivo: true,
      restrizioniAlimentari: "DATO ALIMENTARE RISERVATO",
      allergie: "DATO DA NON ESPORRE",
    })
    .returning({ id: beneficiariTable.id });
  ids.beneficiaries.push(beneficiary.id, milanBeneficiary.id);
  const [card] = await db
    .insert(tessereBeneficiariTable)
    .values({
      beneficiarioId: beneficiary.id,
      codice: `CARD-${rnd()}`,
      createdBy: user.id,
    })
    .returning();
  const [milanCard] = await db
    .insert(tessereBeneficiariTable)
    .values({
      beneficiarioId: milanBeneficiary.id,
      codice: `CARD-MI-${rnd()}`,
      createdBy: user.id,
    })
    .returning();
  const [eligibility] = await db
    .insert(mensaAbilitazioniTable)
    .values({
      beneficiarioId: beneficiary.id,
      mensaId: canteens[0].id,
      dataInizio: "2020-01-01",
      stato: "attiva",
      mensaPrincipale: true,
      createdBy: user.id,
    })
    .returning();
  await db.insert(mensaAbilitazioniTable).values({
    beneficiarioId: milanBeneficiary.id,
    mensaId: canteens[2].id,
    dataInizio: "2020-01-01",
    stato: "attiva",
    mensaPrincipale: true,
    createdBy: user.id,
  });
  return {
    userId: user.id,
    romeId: rome.id,
    milanId: milan.id,
    warehouseIds: warehouses.map((row) => row.id),
    mensaA: canteens[0].id,
    mensaB: canteens[1].id,
    mensaMilan: canteens[2].id,
    beneficiaryId: beneficiary.id,
    milanBeneficiaryId: milanBeneficiary.id,
    cardId: card.id,
    cardCode: card.codice,
    milanCardCode: milanCard.codice,
    eligibilityId: eligibility.id,
  };
}

async function verify(
  app: Express,
  fixture: Fixture,
  values: Record<string, unknown> = {},
) {
  return request(app)
    .post("/mensa/accessi/verifica")
    .send({
      mensaId: fixture.mensaA,
      modalitaAccesso: "tessera",
      codiceTessera: fixture.cardCode,
      tipoServizio: "pranzo",
      idempotencyKey: `access-${rnd()}`,
      ...values,
    });
}

beforeAll(async () => {
  await initDbExtensions();
  await ensureAmbienteModuli();
  await updateModuloAmbiente("MENSA", true, null);
});

afterEach(async () => {
  if (ids.users.length)
    await db
      .delete(auditConfigurazioniTable)
      .where(inArray(auditConfigurazioniTable.utenteId, ids.users));
  if (ids.transfers.length)
    await db
      .delete(trasferimentoRigheTable)
      .where(inArray(trasferimentoRigheTable.trasferimentoId, ids.transfers));
  if (ids.transfers.length)
    await db
      .delete(trasferimentiTable)
      .where(inArray(trasferimentiTable.id, ids.transfers.splice(0)));
  if (ids.beneficiaries.length)
    await db
      .delete(mensaPastiTable)
      .where(inArray(mensaPastiTable.beneficiarioId, ids.beneficiaries));
  if (ids.consumptions.length)
    await db
      .delete(mensaConsumiStorniTable)
      .where(inArray(mensaConsumiStorniTable.consumoId, ids.consumptions));
  if (ids.canteens.length)
    await db
      .delete(mensaConsumiTable)
      .where(inArray(mensaConsumiTable.mensaId, ids.canteens));
  ids.consumptions.splice(0);
  if (ids.products.length)
    await db
      .delete(movimentiTable)
      .where(inArray(movimentiTable.prodottoId, ids.products));
  if (ids.issues.length) {
    await db
      .delete(scaricoRigheTable)
      .where(inArray(scaricoRigheTable.scaricoId, ids.issues));
    await db
      .delete(scarichiTable)
      .where(inArray(scarichiTable.id, ids.issues.splice(0)));
  }
  if (ids.canteens.length)
    await db
      .delete(mensaGiornateServizioTable)
      .where(inArray(mensaGiornateServizioTable.mensaId, ids.canteens));
  if (ids.canteens.length) {
    await db
      .update(mensaAccessiTable)
      .set({ eccezioneId: null })
      .where(inArray(mensaAccessiTable.mensaId, ids.canteens));
  }
  if (ids.beneficiaries.length) {
    await db
      .delete(mensaEccezioniTable)
      .where(inArray(mensaEccezioniTable.beneficiarioId, ids.beneficiaries));
  }
  if (ids.canteens.length) {
    await db
      .delete(mensaAccessiTable)
      .where(inArray(mensaAccessiTable.mensaId, ids.canteens));
    await db
      .delete(mensaAutorizzazioniTemporaneeTable)
      .where(inArray(mensaAutorizzazioniTemporaneeTable.mensaId, ids.canteens));
  }
  if (ids.beneficiaries.length) {
    await db
      .delete(mensaAbilitazioniTable)
      .where(inArray(mensaAbilitazioniTable.beneficiarioId, ids.beneficiaries));
    await db
      .delete(tessereBeneficiariTable)
      .where(
        inArray(tessereBeneficiariTable.beneficiarioId, ids.beneficiaries),
      );
  }
  if (ids.canteens.length)
    await db
      .delete(menseTable)
      .where(inArray(menseTable.id, ids.canteens.splice(0)));
  if (ids.beneficiaries.length)
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, ids.beneficiaries.splice(0)));
  if (ids.lots.length)
    await db
      .delete(lottiTable)
      .where(inArray(lottiTable.id, ids.lots.splice(0)));
  if (ids.products.length)
    await db
      .delete(prodottiTable)
      .where(inArray(prodottiTable.id, ids.products.splice(0)));
  if (ids.warehouses.length)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, ids.warehouses.splice(0)));
  if (ids.centers.length)
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, ids.centers.splice(0)));
  if (ids.zones.length)
    await db
      .delete(zoneUdsTable)
      .where(inArray(zoneUdsTable.id, ids.zones.splice(0)));
  if (ids.users.length)
    await db
      .delete(utentiTable)
      .where(inArray(utentiTable.id, ids.users.splice(0)));
  if (ids.areeOperative.length)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, ids.areeOperative.splice(0)));
});

afterAll(async () => {
  await pool.end();
});

describe("Modulo Mensa", () => {
  it("non somma quantità appartenenti a unità di misura eterogenee", () => {
    const result = aggregatiConsumiMensa([
      {
        causale: "consumo",
        prodottoId: 1,
        prodottoNome: "Farina",
        unitaMisura: "kg",
        quantita: 10,
      },
      {
        causale: "consumo",
        prodottoId: 2,
        prodottoNome: "Piatti",
        unitaMisura: "pz",
        quantita: 20,
      },
      {
        causale: "consumo",
        prodottoId: 3,
        prodottoNome: "Pasta",
        unitaMisura: "kg",
        quantita: 5,
      },
    ]);
    expect(result.consumiPerUnitaMisura).toEqual([
      { unitaMisura: "kg", quantita: 15 },
      { unitaMisura: "pz", quantita: 20 },
    ]);
    expect(result.consumiPerProdotto).toHaveLength(3);
    expect(result).not.toHaveProperty("consumoTotale");
  });

  it("separa lo storico dello stesso Prodotto quando cambia l'unità registrata", () => {
    const result = aggregatiConsumiMensa([
      {
        causale: "consumo",
        prodottoId: 10,
        prodottoNome: "Prodotto legacy",
        unitaMisura: "kg",
        quantita: 3,
      },
      {
        causale: "consumo",
        prodottoId: 10,
        prodottoNome: "Prodotto legacy",
        unitaMisura: "pz",
        quantita: 7,
      },
    ]);
    expect(result.consumiPerProdotto).toEqual([
      {
        prodottoId: 10,
        prodottoNome: "Prodotto legacy",
        unitaMisura: "kg",
        quantita: 3,
      },
      {
        prodottoId: 10,
        prodottoNome: "Prodotto legacy",
        unitaMisura: "pz",
        quantita: 7,
      },
    ]);
    expect(result.consumiPerUnitaMisura).toEqual([
      { unitaMisura: "kg", quantita: 3 },
      { unitaMisura: "pz", quantita: 7 },
    ]);
  });

  it.each([
    ["2026-01-14T22:59:59Z", "2026-01-14"],
    ["2026-01-14T23:00:00Z", "2026-01-15"],
    ["2026-08-14T21:59:59Z", "2026-08-14"],
    ["2026-08-14T22:00:00Z", "2026-08-15"],
  ])(
    "calcola la data servizio Europe/Rome a mezzanotte: %s",
    (instant, expected) => {
      expect(dataServizioMensa(new Date(instant))).toBe(expected);
    },
  );

  it("considera non valido per il pasto un accesso di un istante prima della mezzanotte Europe/Rome", () => {
    expect(
      stessoGiornoServizioMensa(
        new Date("2026-01-14T22:59:59Z"),
        new Date("2026-01-14T23:00:00Z"),
      ),
    ).toBe(false);
  });

  it.each([
    [[], "non_abilitato"],
    [
      [{ stato: "attiva", dataInizio: "2026-08-19", dataFine: null }],
      "programmata",
    ],
    [
      [{ stato: "attiva", dataInizio: "2026-08-01", dataFine: "2026-08-17" }],
      "scaduta",
    ],
    [
      [{ stato: "attiva", dataInizio: "2026-08-01", dataFine: "2026-08-18" }],
      "attiva",
    ],
    [
      [{ stato: "sospesa", dataInizio: "2026-08-01", dataFine: null }],
      "sospesa",
    ],
    [
      [{ stato: "revocata", dataInizio: "2026-08-01", dataFine: null }],
      "revocata",
    ],
  ] as const)(
    "calcola lo stato sintetico Mensa %s come %s",
    (records, expected) => {
      expect(
        riepilogoAbilitazioneMensa(
          records.map((record, index) => ({
            id: index + 1,
            mensaPrincipale: true,
            ...record,
          })),
          "2026-08-18",
        ).stato,
      ).toBe(expected);
    },
  );

  it("restituisce un riepilogo batch minimale, deduplicato e senza PII", async () => {
    const fixture = await createFixture();
    const response = await request(makeApp(fixture, ["mensa.view"])).get(
      `/mensa/abilitazioni/riepilogo-beneficiari?beneficiarioIds=${fixture.beneficiaryId},${fixture.beneficiaryId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(Object.keys(response.body[0]).sort()).toEqual([
      "beneficiarioId",
      "stato",
    ]);
    expect(response.body[0]).toMatchObject({
      beneficiarioId: fixture.beneficiaryId,
      stato: "attiva",
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /Mario|Rossi|NOTA SOCIALE|arachidi|999\.00/,
    );
  });

  it("protegge il riepilogo con modulo, area Mensa e permesso mensa.view", async () => {
    const fixture = await createFixture();
    const path = `/mensa/abilitazioni/riepilogo-beneficiari?beneficiarioIds=${fixture.beneficiaryId}`;
    expect((await request(makeApp(fixture, [])).get(path)).status).toBe(403);
    expect(
      (
        await request(
          makeApp(fixture, ["mensa.view"], { aree: ["sociale"] }),
        ).get(path)
      ).status,
    ).toBe(403);

    await updateModuloAmbiente("MENSA", false, null);
    try {
      expect(
        (await request(makeApp(fixture, ["mensa.view"])).get(path)).status,
      ).toBe(403);
    } finally {
      await updateModuloAmbiente("MENSA", true, null);
    }
  });

  it("valida gli ID del riepilogo e accetta una lista vuota", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture, ["mensa.view"]);
    expect(
      (await request(app).get("/mensa/abilitazioni/riepilogo-beneficiari"))
        .body,
    ).toEqual([]);
    for (const value of ["abc", "0", "1,,2", "-1"]) {
      expect(
        (
          await request(app).get(
            `/mensa/abilitazioni/riepilogo-beneficiari?beneficiarioIds=${value}`,
          )
        ).status,
      ).toBe(400);
    }
    const tooMany = Array.from({ length: 501 }, (_, index) => index + 1).join(
      ",",
    );
    expect(
      (
        await request(app).get(
          `/mensa/abilitazioni/riepilogo-beneficiari?beneficiarioIds=${tooMany}`,
        )
      ).status,
    ).toBe(400);
  });

  it("applica al riepilogo gli scope area operativa, Centro di Ascolto e zona UDS", async () => {
    const fixture = await createFixture();
    const [centroA, centroB] = await db
      .insert(centriAscoltoTable)
      .values([
        { nome: `Centro A ${rnd()}`, areaOperativaId: fixture.romeId },
        { nome: `Centro B ${rnd()}`, areaOperativaId: fixture.romeId },
      ])
      .returning({ id: centriAscoltoTable.id });
    ids.centers.push(centroA.id, centroB.id);
    const [zonaA, zonaB] = await db
      .insert(zoneUdsTable)
      .values([
        { nome: `Zona A ${rnd()}`, areaOperativaId: fixture.romeId },
        { nome: `Zona B ${rnd()}`, areaOperativaId: fixture.romeId },
      ])
      .returning({ id: zoneUdsTable.id });
    ids.zones.push(zonaA.id, zonaB.id);
    const scoped = await db
      .insert(beneficiariTable)
      .values([
        {
          codice: `BEN-A-${rnd()}`,
          nome: "A",
          cognome: "Scope",
          areaOperativaId: fixture.romeId,
          centroAscoltoId: centroA.id,
          zonaUdsId: zonaA.id,
        },
        {
          codice: `BEN-B-${rnd()}`,
          nome: "B",
          cognome: "Scope",
          areaOperativaId: fixture.romeId,
          centroAscoltoId: centroB.id,
          zonaUdsId: zonaB.id,
        },
      ])
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(...scoped.map((row) => row.id));
    const requestedIds = [
      scoped[0].id,
      scoped[1].id,
      fixture.milanBeneficiaryId,
    ].join(",");
    const path = `/mensa/abilitazioni/riepilogo-beneficiari?beneficiarioIds=${requestedIds}`;
    const expected = [
      {
        beneficiarioId: scoped[0].id,
        stato: "non_abilitato",
      },
    ];

    const areaOperativaScoped = await request(makeApp(fixture, ["mensa.view"])).get(
      path,
    );
    expect(areaOperativaScoped.status).toBe(200);
    expect(
      areaOperativaScoped.body.map(
        (row: { beneficiarioId: number }) => row.beneficiarioId,
      ),
    ).not.toContain(fixture.milanBeneficiaryId);
    const centerScoped = await request(
      makeApp(fixture, ["mensa.view"], { centroAscoltoId: centroA.id }),
    ).get(path);
    expect(centerScoped.status).toBe(200);
    expect(centerScoped.body).toEqual(expected);
    const zoneScoped = await request(
      makeApp(fixture, ["mensa.view"], { zonaUdsId: zonaA.id }),
    ).get(path);
    expect(zoneScoped.status).toBe(200);
    expect(zoneScoped.body).toEqual(expected);
  });

  it("scade la principale terminata ieri e consente una nuova abilitazione oggi", async () => {
    const fixture = await createFixture();
    const today = dataServizioMensa();
    await db
      .update(mensaAbilitazioniTable)
      .set({ dataFine: shiftDate(today, -1), stato: "attiva" })
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));

    const response = await request(makeApp(fixture))
      .post("/mensa/abilitazioni")
      .send({
        beneficiarioId: fixture.beneficiaryId,
        mensaId: fixture.mensaB,
        dataInizio: today,
        mensaPrincipale: true,
      });

    expect(response.status).toBe(201);
    const history = await db
      .select({
        id: mensaAbilitazioniTable.id,
        stato: mensaAbilitazioniTable.stato,
      })
      .from(mensaAbilitazioniTable)
      .where(eq(mensaAbilitazioniTable.beneficiarioId, fixture.beneficiaryId));
    expect(history).toEqual(
      expect.arrayContaining([
        { id: fixture.eligibilityId, stato: "scaduta" },
        { id: response.body.id, stato: "attiva" },
      ]),
    );
  });

  it("rifiuta una nuova principale se quella esistente è ancora temporalmente valida", async () => {
    const fixture = await createFixture();
    const today = dataServizioMensa();
    await db
      .update(mensaAbilitazioniTable)
      .set({ dataFine: shiftDate(today, 1), stato: "attiva" })
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));

    const response = await request(makeApp(fixture))
      .post("/mensa/abilitazioni")
      .send({
        beneficiarioId: fixture.beneficiaryId,
        mensaId: fixture.mensaB,
        dataInizio: today,
        mensaPrincipale: true,
      });

    expect(response.status).toBe(409);
  });

  it("mantiene esplicita e protetta l'abilitazione dalla scheda Beneficiario", async () => {
    const fixture = await createFixture();
    await db
      .delete(mensaAbilitazioniTable)
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));
    const app = makeApp(fixture);

    const deniedBefore = await verify(app, fixture);
    expect(deniedBefore.status).toBe(201);
    expect(deniedBefore.body).toMatchObject({
      esito: "negato",
      motivoEsito: "ABILITAZIONE_NON_PRESENTE",
    });

    const viewOnly = makeApp(fixture, ["mensa.view"]);
    const visibleHistory = await request(viewOnly).get(
      `/mensa/abilitazioni?beneficiarioId=${fixture.beneficiaryId}`,
    );
    expect(visibleHistory.status).toBe(200);
    expect(visibleHistory.body).toEqual([]);
    const forbiddenCreate = await request(viewOnly)
      .post("/mensa/abilitazioni")
      .send({
        beneficiarioId: fixture.beneficiaryId,
        mensaId: fixture.mensaA,
        dataInizio: dataServizioMensa(),
        mensaPrincipale: true,
      });
    expect(forbiddenCreate.status).toBe(403);

    const outsideScope = await request(app).post("/mensa/abilitazioni").send({
      beneficiarioId: fixture.milanBeneficiaryId,
      mensaId: fixture.mensaMilan,
      dataInizio: dataServizioMensa(),
      mensaPrincipale: true,
    });
    expect(outsideScope.status).toBe(403);

    const created = await request(app).post("/mensa/abilitazioni").send({
      beneficiarioId: fixture.beneficiaryId,
      mensaId: fixture.mensaA,
      dataInizio: dataServizioMensa(),
      mensaPrincipale: true,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      beneficiarioId: fixture.beneficiaryId,
      mensaId: fixture.mensaA,
      stato: "attiva",
      mensaPrincipale: true,
    });

    const allowedAfter = await verify(app, fixture);
    expect(allowedAfter.status).toBe(201);
    expect(allowedAfter.body).toMatchObject({
      esito: "consentito",
      motivoEsito: "CONSENTITO",
    });

    const duplicate = await request(app).post("/mensa/abilitazioni").send({
      beneficiarioId: fixture.beneficiaryId,
      mensaId: fixture.mensaB,
      dataInizio: dataServizioMensa(),
      mensaPrincipale: true,
    });
    expect(duplicate.status).toBe(409);
  });

  it.each(["sospesa", "revocata"] as const)(
    "non considera bloccante una principale %s",
    async (stato) => {
      const fixture = await createFixture();
      const today = dataServizioMensa();
      await db
        .update(mensaAbilitazioniTable)
        .set({ stato })
        .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));

      const response = await request(makeApp(fixture))
        .post("/mensa/abilitazioni")
        .send({
          beneficiarioId: fixture.beneficiaryId,
          mensaId: fixture.mensaB,
          dataInizio: today,
          mensaPrincipale: true,
        });

      expect(response.status).toBe(201);
    },
  );

  it("activeEligibility applica la data civile Europe/Rome vicino a mezzanotte", async () => {
    const fixture = await createFixture();
    await db
      .update(mensaAbilitazioniTable)
      .set({ dataInizio: "2026-01-15", dataFine: "2026-01-15" })
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));

    const beforeRomeMidnight = dataServizioMensa(
      new Date("2026-01-14T22:59:59Z"),
    );
    const afterRomeMidnight = dataServizioMensa(
      new Date("2026-01-14T23:00:00Z"),
    );
    expect(
      await activeEligibility(fixture.beneficiaryId, beforeRomeMidnight),
    ).toBeNull();
    expect(
      await activeEligibility(fixture.beneficiaryId, afterRomeMidnight),
    ).toMatchObject({
      abilitazione: { id: fixture.eligibilityId },
    });
  });

  it("gestisce più Mense nella stessa area operativa e non espone quelle di altre area operativa", async () => {
    const fixture = await createFixture();
    const response = await request(makeApp(fixture)).get("/mensa/mense");
    expect(response.status).toBe(200);
    expect(response.body.map((row: { id: number }) => row.id).sort()).toEqual(
      [fixture.mensaA, fixture.mensaB].sort(),
    );
  });

  it("nega anche dalle route logistiche generiche i trasferimenti Mensa di un'altra area operativa", async () => {
    const fixture = await createFixture();
    const [transfer] = await db
      .insert(trasferimentiTable)
      .values({
        codice: `TR-CROSS-${rnd()}`,
        magazzinoOrigineId: fixture.warehouseIds[0],
        magazzinoDestinoId: fixture.warehouseIds[2],
        mensaId: fixture.mensaMilan,
        dataRichiesta: "2026-08-14",
        operatoreId: fixture.userId,
      })
      .returning({ id: trasferimentiTable.id });
    ids.transfers.push(transfer.id);
    const app = makeApp(fixture);

    const detail = await request(app).get(`/trasferimenti/${transfer.id}`);
    expect(detail.status).toBe(403);
    const list = await request(app).get("/trasferimenti");
    expect(list.status).toBe(200);
    expect(list.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: transfer.id })]),
    );
  });

  it("non usa le chiavi idempotenti come capability di lettura cross-Area", async () => {
    const fixture = await createFixture();
    const appRome = makeApp(fixture);
    const appMilan = makeApp(fixture, undefined, { areaOperativaId: fixture.milanId });

    const accessKey = `scope-access-${rnd()}`;
    const access = await verify(appRome, fixture, {
      idempotencyKey: accessKey,
    });
    expect(access.status).toBe(201);
    const crossAccess = await request(appMilan)
      .post("/mensa/accessi/verifica")
      .send({
        mensaId: fixture.mensaMilan,
        modalitaAccesso: "tessera",
        codiceTessera: fixture.milanCardCode,
        tipoServizio: "pranzo",
        idempotencyKey: accessKey,
      });
    expect(crossAccess.status).toBe(403);
    expect(crossAccess.body).not.toHaveProperty("beneficiario");
    expect(crossAccess.body).not.toHaveProperty("allergie");

    const mealKey = `scope-meal-${rnd()}`;
    const meal = await request(appRome).post("/mensa/pasti").send({
      accessoMensaId: access.body.id,
      tipoServizio: "pranzo",
      idempotencyKey: mealKey,
    });
    expect(meal.status).toBe(201);
    const crossMeal = await request(appMilan).post("/mensa/pasti").send({
      accessoMensaId: access.body.id,
      tipoServizio: "pranzo",
      idempotencyKey: mealKey,
    });
    expect(crossMeal.status).toBe(403);
    expect(crossMeal.body).not.toHaveProperty("beneficiarioId");

    const [temporaryBeneficiary] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BEN-SCOPE-${rnd()}`,
        nome: "Persona",
        cognome: "Temporanea",
        areaOperativaId: fixture.romeId,
      })
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(temporaryBeneficiary.id);
    const temporaryKey = `scope-temp-${rnd()}`;
    expect(
      (
        await request(appRome).post("/mensa/accessi/temporaneo").send({
          mensaId: fixture.mensaA,
          beneficiarioId: temporaryBeneficiary.id,
          tipoServizio: "cena",
          motivo: "Test scope",
          idempotencyKey: temporaryKey,
        })
      ).status,
    ).toBe(201);
    const crossTemporary = await request(appMilan)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaMilan,
        beneficiarioId: fixture.milanBeneficiaryId,
        tipoServizio: "cena",
        motivo: "Replay fuori Area",
        idempotencyKey: temporaryKey,
      });
    expect(crossTemporary.status).toBe(403);
    expect(crossTemporary.body).not.toHaveProperty("beneficiario");

    const [product] = await db
      .insert(prodottiTable)
      .values({
        codice: `PSCOPE-${rnd()}`,
        nome: "Prodotto scope",
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
      })
      .returning({ id: prodottiTable.id });
    ids.products.push(product.id);
    const [lot] = await db
      .insert(lottiTable)
      .values({
        prodottoId: product.id,
        codiceLotto: `LS-${rnd()}`,
        dataScadenza: "2027-12-31",
        dataCarico: dataServizioMensa(),
        quantitaCaricata: "4.00",
        quantitaResidua: "4.00",
        magazzinoId: fixture.warehouseIds[0],
      })
      .returning({ id: lottiTable.id });
    ids.lots.push(lot.id);
    const consumptionKey = `scope-consumption-${rnd()}`;
    const consumption = await request(appRome).post("/mensa/consumi").send({
      mensaId: fixture.mensaA,
      dataServizio: dataServizioMensa(),
      tipoServizio: "cena",
      prodottoId: product.id,
      quantita: 1,
      causale: "consumo",
      idempotencyKey: consumptionKey,
    });
    expect(consumption.status).toBe(201);
    ids.consumptions.push(consumption.body.id);
    ids.issues.push(consumption.body.scaricoId);
    const crossConsumption = await request(appMilan)
      .post("/mensa/consumi")
      .send({
        mensaId: fixture.mensaMilan,
        dataServizio: dataServizioMensa(),
        tipoServizio: "cena",
        prodottoId: product.id,
        quantita: 1,
        causale: "consumo",
        idempotencyKey: consumptionKey,
      });
    expect(crossConsumption.status).toBe(403);
    expect(crossConsumption.body).not.toHaveProperty("prodottoId");

    const transferKey = `scope-transfer-${rnd()}`;
    const transfer = await request(appRome)
      .post("/mensa/trasferimenti")
      .send({
        mensaId: fixture.mensaA,
        magazzinoOrigineId: fixture.warehouseIds[1],
        dataRichiesta: dataServizioMensa(),
        idempotencyKey: transferKey,
        righe: [{ prodottoId: product.id, quantita: 1 }],
      });
    expect(transfer.status).toBe(201);
    ids.transfers.push(transfer.body.id);
    const [milanOrigin] = await db
      .insert(magazziniTable)
      .values({
        codice: `MI-OR-${rnd()}`,
        nome: "Origine Milano",
        areaOperativaId: fixture.milanId,
        tipoMagazzino: "logistico",
      })
      .returning({ id: magazziniTable.id });
    ids.warehouses.push(milanOrigin.id);
    const crossTransfer = await request(appMilan)
      .post("/mensa/trasferimenti")
      .send({
        mensaId: fixture.mensaMilan,
        magazzinoOrigineId: milanOrigin.id,
        dataRichiesta: dataServizioMensa(),
        idempotencyKey: transferKey,
        righe: [{ prodottoId: product.id, quantita: 1 }],
      });
    expect(crossTransfer.status).toBe(403);
    expect(crossTransfer.body).not.toHaveProperty("id");
  });

  it("separa richiesta, spedizione e ricezione dei rifornimenti Mensa", async () => {
    const fixture = await createFixture();
    const [product] = await db
      .insert(prodottiTable)
      .values({
        codice: `PTR-${rnd()}`,
        nome: "Prodotto trasferimento permessi",
        tipoProdotto: "alimentare",
        unitaMisura: "pz",
      })
      .returning({ id: prodottiTable.id });
    ids.products.push(product.id);
    const permissions = [
      "mensa.view",
      "mensa.transfers.request",
      "mensa.transfers.receive",
    ];
    const mismatchedKey = `transfer-mismatch-${rnd()}`;
    const mismatched = await request(makeApp(fixture, permissions))
      .post("/mensa/trasferimenti")
      .send({
        mensaId: fixture.mensaA,
        magazzinoOrigineId: fixture.warehouseIds[1],
        dataRichiesta: dataServizioMensa(),
        idempotencyKey: mismatchedKey,
        righe: [{ prodottoId: product.id, quantita: 1, unitaMisura: "kg" }],
      });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error).toMatch(/deve essere pz/i);
    const malformedKey = `transfer-malformed-${rnd()}`;
    const malformed = await request(makeApp(fixture, permissions))
      .post("/mensa/trasferimenti")
      .send({
        mensaId: fixture.mensaA,
        magazzinoOrigineId: fixture.warehouseIds[1],
        dataRichiesta: dataServizioMensa(),
        idempotencyKey: malformedKey,
        righe: [{ prodottoId: product.id, quantita: 1, unitaMisura: 42 }],
      });
    expect(malformed.status).toBe(400);
    expect(
      await db
        .select({ id: trasferimentiTable.id })
        .from(trasferimentiTable)
        .where(
          inArray(trasferimentiTable.idempotencyKey, [
            mismatchedKey,
            malformedKey,
          ]),
        ),
    ).toEqual([]);
    expect(
      await db
        .select({ id: trasferimentoRigheTable.id })
        .from(trasferimentoRigheTable)
        .where(eq(trasferimentoRigheTable.prodottoId, product.id)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: movimentiTable.id })
        .from(movimentiTable)
        .where(eq(movimentiTable.prodottoId, product.id)),
    ).toEqual([]);
    const requested = await request(makeApp(fixture, permissions))
      .post("/mensa/trasferimenti")
      .send({
        mensaId: fixture.mensaA,
        magazzinoOrigineId: fixture.warehouseIds[1],
        dataRichiesta: dataServizioMensa(),
        idempotencyKey: `transfer-request-${rnd()}`,
        righe: [{ prodottoId: product.id, quantita: 1 }],
      });
    expect(requested.status).toBe(201);
    ids.transfers.push(requested.body.id);
    const [savedRow] = await db
      .select({ unitaMisura: trasferimentoRigheTable.unitaMisura })
      .from(trasferimentoRigheTable)
      .where(eq(trasferimentoRigheTable.trasferimentoId, requested.body.id));
    expect(savedRow.unitaMisura).toBe("pz");
    const requestedWithNull = await request(makeApp(fixture, permissions))
      .post("/mensa/trasferimenti")
      .send({
        mensaId: fixture.mensaA,
        magazzinoOrigineId: fixture.warehouseIds[1],
        dataRichiesta: dataServizioMensa(),
        idempotencyKey: `transfer-null-unit-${rnd()}`,
        righe: [{ prodottoId: product.id, quantita: 1, unitaMisura: null }],
      });
    expect(requestedWithNull.status).toBe(201);
    ids.transfers.push(requestedWithNull.body.id);
    const [savedNullUnitRow] = await db
      .select({ unitaMisura: trasferimentoRigheTable.unitaMisura })
      .from(trasferimentoRigheTable)
      .where(
        eq(trasferimentoRigheTable.trasferimentoId, requestedWithNull.body.id),
      );
    expect(savedNullUnitRow.unitaMisura).toBe("pz");
    const deniedDispatch = await request(makeApp(fixture, permissions))
      .post(`/trasferimenti/${requested.body.id}/avvia`)
      .send({ versione: 1 });
    expect(deniedDispatch.status).toBe(403);

    const [inTransit] = await db
      .insert(trasferimentiTable)
      .values({
        codice: `TR-RECV-${rnd()}`,
        magazzinoOrigineId: fixture.warehouseIds[1],
        magazzinoDestinoId: fixture.warehouseIds[0],
        mensaId: fixture.mensaA,
        dataRichiesta: dataServizioMensa(),
        dataEsecuzione: dataServizioMensa(),
        stato: "in_transito",
        operatoreId: fixture.userId,
      })
      .returning({
        id: trasferimentiTable.id,
        versione: trasferimentiTable.versione,
      });
    ids.transfers.push(inTransit.id);
    const received = await request(makeApp(fixture, permissions))
      .post(`/trasferimenti/${inTransit.id}/conferma`)
      .send({ versione: inTransit.versione });
    expect(received.status).toBe(200);
    expect(received.body.stato).toBe("completato");
  });

  it("crea atomicamente Mensa e magazzino dedicato con Area, Centro e codice automatico", async () => {
    const fixture = await createFixture();
    const withoutManage = MENSA_PERMISSIONS.map((item) => item.key).filter(
      (key) => key !== "mensa.manage",
    );
    expect(
      (
        await request(makeApp(fixture, withoutManage))
          .post("/mensa/mense")
          .send({})
      ).status,
    ).toBe(403);

    const [centro] = await db
      .insert(centriAscoltoTable)
      .values({
        nome: `Centro Mensa ${rnd()}`,
        areaOperativaId: fixture.romeId,
      })
      .returning({ id: centriAscoltoTable.id });
    ids.centers.push(centro.id);

    const response = await request(makeApp(fixture)).post("/mensa/mense").send({
      nome: "Mensa Area Roma",
      centroAscoltoId: centro.id,
      indirizzo: "Via del Pane 10",
      comune: "Roma",
      zona: "Nord",
      responsabile: "Ada Rossi",
      telefono: "0612345678",
      email: "mensa@example.test",
      note: "Sede dedicata",
    });
    expect(response.status).toBe(201);
    ids.canteens.push(response.body.id);
    ids.warehouses.push(response.body.magazzinoId);
    expect(response.body).toMatchObject({
      nome: "Mensa Area Roma",
      areaOperativaId: fixture.romeId,
      centroAscoltoId: centro.id,
      comune: "Roma",
      zona: "Nord",
      responsabile: "Ada Rossi",
      stato: "attivo",
      attiva: true,
    });
    expect(response.body.codice).toMatch(/^MEN-\d+$/);

    const [warehouse] = await db
      .select()
      .from(magazziniTable)
      .where(eq(magazziniTable.id, response.body.magazzinoId));
    expect(warehouse).toMatchObject({
      nome: "Mensa Area Roma",
      areaOperativaId: fixture.romeId,
      centroAscoltoId: centro.id,
      tipoMagazzino: "mensa",
      stato: "attivo",
      comune: "Roma",
      zona: "Nord",
      responsabile: "Ada Rossi",
    });
    expect(warehouse.codice).toMatch(/^MAG-\d+$/);
  });

  it("non converte né associa un magazzino logistico esistente", async () => {
    const fixture = await createFixture();
    const [logisticsWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `LOG-${rnd()}`,
        nome: "Magazzino centrale logistico",
        areaOperativaId: fixture.romeId,
        tipoMagazzino: "logistico",
      })
      .returning({ id: magazziniTable.id });
    ids.warehouses.push(logisticsWarehouse.id);
    const logisticsResponse = await request(makeApp(fixture))
      .post("/mensa/mense")
      .send({
        codice: `MENSA-LOG-${rnd()}`,
        nome: "Mensa su magazzino logistico",
        magazzinoId: logisticsWarehouse.id,
      });
    expect(logisticsResponse.status).toBe(400);
    const [logisticsUnchanged] = await db
      .select({ tipoMagazzino: magazziniTable.tipoMagazzino })
      .from(magazziniTable)
      .where(eq(magazziniTable.id, logisticsWarehouse.id));
    expect(logisticsUnchanged.tipoMagazzino).toBe("logistico");
  });

  it("vincola Centro di Ascolto e Area e non crea record parziali", async () => {
    const fixture = await createFixture();
    const [centroMilano] = await db
      .insert(centriAscoltoTable)
      .values({ nome: `Centro Milano ${rnd()}`, areaOperativaId: fixture.milanId })
      .returning({ id: centriAscoltoTable.id });
    ids.centers.push(centroMilano.id);
    const before = await db
      .select({ id: magazziniTable.id })
      .from(magazziniTable);
    const response = await request(makeApp(fixture)).post("/mensa/mense").send({
      nome: "Mensa non coerente",
      centroAscoltoId: centroMilano.id,
    });
    expect(response.status).toBe(400);
    const after = await db
      .select({ id: magazziniTable.id })
      .from(magazziniTable);
    expect(after).toHaveLength(before.length);
  });

  it("richiede l'Area agli utenti globali e impedisce override territoriali", async () => {
    const fixture = await createFixture();
    const globalApp = makeApp(fixture, undefined, { areaOperativaId: null });
    expect(
      (
        await request(globalApp)
          .post("/mensa/mense")
          .send({ nome: "Senza area" })
      ).status,
    ).toBe(400);

    const created = await request(globalApp).post("/mensa/mense").send({
      nome: "Mensa Milano globale",
      areaOperativaId: fixture.milanId,
    });
    expect(created.status).toBe(201);
    ids.canteens.push(created.body.id);
    ids.warehouses.push(created.body.magazzinoId);
    expect(created.body.areaOperativaId).toBe(fixture.milanId);

    const override = await request(makeApp(fixture))
      .post("/mensa/mense")
      .send({ nome: "Override non ammesso", areaOperativaId: fixture.milanId });
    expect(override.status).toBe(403);
  });

  it("impedisce operazioni Mensa quando il magazzino associato è inattivo", async () => {
    const fixture = await createFixture();
    await db
      .update(magazziniTable)
      .set({ stato: "inattivo" })
      .where(eq(magazziniTable.id, fixture.warehouseIds[0]));

    const access = await verify(makeApp(fixture), fixture);
    expect(access.status).toBe(201);
    expect(access.body.motivoEsito).toBe("MENSA_NON_ATTIVA");

    const stock = await request(makeApp(fixture)).get(
      `/mensa/logistica/giacenze?magazzinoId=${fixture.warehouseIds[0]}`,
    );
    expect(stock.status).toBe(409);
  });

  it("separa la disattivazione del servizio dallo stato del magazzino Mensa", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const current = await request(app).get(`/mensa/mense/${fixture.mensaA}`);
    expect(current.body).toMatchObject({
      statoServizio: "attivo",
      statoMagazzino: "attivo",
    });

    const disabled = await request(app)
      .patch(`/mensa/mense/${fixture.mensaA}`)
      .send({ attiva: false, versione: current.body.versione });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({
      statoServizio: "inattivo",
      statoMagazzino: "attivo",
    });
    const [warehouse] = await db
      .select({ stato: magazziniTable.stato })
      .from(magazziniTable)
      .where(eq(magazziniTable.id, fixture.warehouseIds[0]));
    expect(warehouse.stato).toBe("attivo");
    const access = await verify(app, fixture, { tipoServizio: "cena" });
    expect(access.body.motivoEsito).toBe("MENSA_NON_ATTIVA");
  });

  it("esclude i magazzini senza area operativa dallo scope logistico territoriale", async () => {
    const fixture = await createFixture();
    const [legacyWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `LEG-${rnd()}`,
        nome: "Magazzino legacy senza area operativa",
        areaOperativaId: null,
        tipoMagazzino: "logistico",
      })
      .returning({ id: magazziniTable.id });
    ids.warehouses.push(legacyWarehouse.id);
    const response = await request(makeApp(fixture)).get(
      "/mensa/logistica/magazzini",
    );
    expect(response.status).toBe(200);
    expect(response.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: legacyWarehouse.id }),
      ]),
    );
  });

  it("consente la tessera valida nella Mensa assegnata senza esporre dati sociali", async () => {
    const fixture = await createFixture();
    const response = await verify(makeApp(fixture), fixture);
    expect(response.status).toBe(201);
    expect(response.body.esito).toBe("consentito");
    expect(response.body.allergie).toBe("arachidi");
    expect(JSON.stringify(response.body)).not.toContain(
      "NOTA SOCIALE RISERVATA",
    );
    expect(response.body).not.toHaveProperty("creditoSolidaleSaldo");
  });

  it("registra il rifiuto per tessera inesistente", async () => {
    const fixture = await createFixture();
    const response = await verify(makeApp(fixture), fixture, {
      codiceTessera: "inesistente",
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      esito: "negato",
      motivoEsito: "TESSERA_NON_VALIDA",
      beneficiarioId: null,
    });
  });

  it.each([
    ["sospesa", "TESSERA_SOSPESA"],
    ["revocata", "TESSERA_REVOCATA"],
    ["scaduta", "TESSERA_SCADUTA"],
  ] as const)("nega una tessera %s", async (state, reason) => {
    const fixture = await createFixture();
    await db
      .update(tessereBeneficiariTable)
      .set({ stato: state })
      .where(eq(tessereBeneficiariTable.id, fixture.cardId));
    const response = await verify(makeApp(fixture), fixture);
    expect(response.body).toMatchObject({
      esito: "negato",
      motivoEsito: reason,
    });
  });

  it("propone e registra un'eccezione esplicita soltanto tra Mense della stessa area operativa", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const denied = await verify(app, fixture, { mensaId: fixture.mensaB });
    expect(denied.body).toMatchObject({
      motivoEsito: "MENSA_NON_AUTORIZZATA",
      eccezionePossibile: true,
    });
    const allowed = await request(app)
      .post(`/mensa/accessi/${denied.body.id}/eccezione`)
      .send({ motivo: "Servizio chiuso nella Mensa principale" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.esito).toBe("consentito_eccezione");
    const [stored] = await db
      .select()
      .from(mensaEccezioniTable)
      .where(eq(mensaEccezioniTable.accessoMensaId, denied.body.id));
    expect(stored.mensaDestinazioneId).toBe(fixture.mensaB);
  });

  it("rende la chiusura dominante e blocca eccezioni su accessi precedenti", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const today = dataServizioMensa();
    const deniedBeforeClosure = await verify(app, fixture, {
      mensaId: fixture.mensaB,
      tipoServizio: "pranzo",
    });
    expect(deniedBeforeClosure.body).toMatchObject({
      esito: "negato",
      motivoEsito: "MENSA_NON_AUTORIZZATA",
      eccezionePossibile: true,
    });
    const [day] = await db
      .insert(mensaGiornateServizioTable)
      .values({
        mensaId: fixture.mensaB,
        dataServizio: today,
        tipoServizio: "pranzo",
        apertaDa: fixture.userId,
      })
      .returning({ id: mensaGiornateServizioTable.id });
    const closed = await request(app)
      .post(`/mensa/giornate/${day.id}/chiudi`)
      .send({ note: "Fine servizio" });
    expect(closed.status).toBe(200);

    const exception = await request(app)
      .post(`/mensa/accessi/${deniedBeforeClosure.body.id}/eccezione`)
      .send({ motivo: "Non deve essere concessa" });
    expect(exception.status).toBe(409);
    expect(
      await db
        .select()
        .from(mensaEccezioniTable)
        .where(
          eq(mensaEccezioniTable.accessoMensaId, deniedBeforeClosure.body.id),
        ),
    ).toHaveLength(0);
    const [unchangedAccess] = await db
      .select()
      .from(mensaAccessiTable)
      .where(eq(mensaAccessiTable.id, deniedBeforeClosure.body.id));
    expect(unchangedAccess).toMatchObject({
      esito: "negato",
      motivoEsito: "MENSA_NON_AUTORIZZATA",
      eccezioneId: null,
    });
    expect(
      await db
        .select()
        .from(auditConfigurazioniTable)
        .where(
          and(
            eq(
              auditConfigurazioniTable.chiave,
              `mensa-accesso:${deniedBeforeClosure.body.id}`,
            ),
            eq(auditConfigurazioniTable.azione, "eccezione-stessa-area"),
          ),
        ),
    ).toHaveLength(0);
    const [storedDay] = await db
      .select({ snapshot: mensaGiornateServizioTable.snapshot })
      .from(mensaGiornateServizioTable)
      .where(eq(mensaGiornateServizioTable.id, day.id));
    expect(storedDay.snapshot).toEqual(closed.body.snapshot);

    const deniedAfterClosure = await verify(app, fixture, {
      mensaId: fixture.mensaB,
      tipoServizio: "pranzo",
    });
    expect(deniedAfterClosure.body).toMatchObject({
      esito: "negato",
      motivoEsito: "SERVIZIO_CHIUSO",
      eccezionePossibile: false,
    });
  });

  it("serializza chiusura ed eccezione concorrenti senza eccezioni post-snapshot", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const denied = await verify(app, fixture, {
      mensaId: fixture.mensaB,
      tipoServizio: "pranzo",
    });
    const [day] = await db
      .insert(mensaGiornateServizioTable)
      .values({
        mensaId: fixture.mensaB,
        dataServizio: dataServizioMensa(),
        tipoServizio: "pranzo",
        apertaDa: fixture.userId,
      })
      .returning({ id: mensaGiornateServizioTable.id });

    const [closure, exception] = await Promise.all([
      request(app)
        .post(`/mensa/giornate/${day.id}/chiudi`)
        .send({ note: "Chiusura concorrente" }),
      request(app)
        .post(`/mensa/accessi/${denied.body.id}/eccezione`)
        .send({ motivo: "Eccezione concorrente" }),
    ]);
    expect(closure.status).toBe(200);
    expect([200, 409]).toContain(exception.status);

    const [storedAccess] = await db
      .select()
      .from(mensaAccessiTable)
      .where(eq(mensaAccessiTable.id, denied.body.id));
    const storedExceptions = await db
      .select()
      .from(mensaEccezioniTable)
      .where(eq(mensaEccezioniTable.accessoMensaId, denied.body.id));
    if (exception.status === 200) {
      expect(storedAccess.esito).toBe("consentito_eccezione");
      expect(storedExceptions).toHaveLength(1);
      expect(closure.body.snapshot.accessiEccezione).toBe(1);
    } else {
      expect(storedAccess.esito).toBe("negato");
      expect(storedExceptions).toHaveLength(0);
      expect(closure.body.snapshot.accessiNegati).toBe(1);
    }
  });

  it("nega l'altra area operativa e non restituisce identità o informazioni alimentari", async () => {
    const fixture = await createFixture();
    const response = await verify(makeApp(fixture), fixture, {
      codiceTessera: fixture.milanCardCode,
    });
    expect(response.body).toMatchObject({
      motivoEsito: "AREA_NON_COMPATIBILE",
      beneficiarioId: null,
      beneficiarioNome: null,
      beneficiarioCodice: null,
      mensaPrincipaleId: null,
      mensaPrincipaleNome: null,
      statoAbilitazione: null,
      restrizioniAlimentari: null,
      allergie: null,
      eccezionePossibile: false,
    });
  });

  it("applica le sospensioni, revoche, scadenze e lo stato del beneficiario", async () => {
    const fixture = await createFixture();
    await db
      .update(mensaAbilitazioniTable)
      .set({ stato: "sospesa" })
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));
    expect((await verify(makeApp(fixture), fixture)).body.motivoEsito).toBe(
      "ABILITAZIONE_SOSPESA",
    );
    await db
      .update(mensaAbilitazioniTable)
      .set({ stato: "revocata" })
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));
    expect((await verify(makeApp(fixture), fixture)).body.motivoEsito).toBe(
      "ABILITAZIONE_REVOCATA",
    );
    await db
      .update(mensaAbilitazioniTable)
      .set({ stato: "attiva", dataFine: "2020-01-02" })
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));
    expect((await verify(makeApp(fixture), fixture)).body.motivoEsito).toBe(
      "ABILITAZIONE_SCADUTA",
    );
    await db
      .update(beneficiariTable)
      .set({ attivo: false })
      .where(eq(beneficiariTable.id, fixture.beneficiaryId));
    expect((await verify(makeApp(fixture), fixture)).body.motivoEsito).toBe(
      "BENEFICIARIO_NON_ATTIVO",
    );
  });

  it("nega l'accesso a una Mensa disattivata", async () => {
    const fixture = await createFixture();
    await db
      .update(menseTable)
      .set({ attiva: false })
      .where(eq(menseTable.id, fixture.mensaA));
    const response = await verify(makeApp(fixture), fixture);
    expect(response.body.motivoEsito).toBe("MENSA_NON_ATTIVA");
  });

  it("consente la ricerca manuale solo col permesso dedicato e non aggira l'abilitazione", async () => {
    const fixture = await createFixture();
    const allowed = await verify(makeApp(fixture), fixture, {
      modalitaAccesso: "manuale",
      beneficiarioId: fixture.beneficiaryId,
      codiceTessera: undefined,
    });
    expect(allowed.body).toMatchObject({
      esito: "consentito",
      modalitaAccesso: "manuale",
    });
    const withoutManual = MENSA_PERMISSIONS.map((item) => item.key).filter(
      (key) => key !== "mensa.access.manual",
    );
    const denied = await verify(makeApp(fixture, withoutManual), fixture, {
      modalitaAccesso: "manuale",
      beneficiarioId: fixture.beneficiaryId,
      codiceTessera: undefined,
    });
    expect(denied.status).toBe(403);
  });

  it("crea e conserva lo storico di abilitazione e tessera", async () => {
    const fixture = await createFixture();
    const [center] = await db
      .insert(centriAscoltoTable)
      .values({ nome: `Centro tessere ${rnd()}`, areaOperativaId: fixture.romeId })
      .returning({ id: centriAscoltoTable.id });
    ids.centers.push(center.id);
    const [beneficiary] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BEN-ST-${rnd()}`,
        nome: "Storico",
        cognome: "Mensa",
        areaOperativaId: fixture.romeId,
        centroAscoltoId: center.id,
        sesso: "M",
        fasciaEtaPresunta: "30_64",
        attivo: true,
      })
      .returning({
        id: beneficiariTable.id,
        codice: beneficiariTable.codice,
      });
    ids.beneficiaries.push(beneficiary.id);
    const app = makeApp(fixture);
    const eligibility = await request(app).post("/mensa/abilitazioni").send({
      beneficiarioId: beneficiary.id,
      mensaId: fixture.mensaB,
      dataInizio: "2026-01-01",
      motivo: "Avvio servizio",
    });
    expect(eligibility.status).toBe(201);
    const suspended = await request(app)
      .post(`/mensa/abilitazioni/${eligibility.body.id}/stato`)
      .send({
        stato: "sospesa",
        motivo: "Sospensione temporanea",
        versione: eligibility.body.versione,
      });
    expect(suspended.status).toBe(200);
    expect(suspended.body.stato).toBe("sospesa");
    const staleUpdate = await request(app)
      .post(`/mensa/abilitazioni/${eligibility.body.id}/stato`)
      .send({
        stato: "attiva",
        versione: eligibility.body.versione,
      });
    expect(staleUpdate.status).toBe(409);

    const card = await request(app).post("/mensa/tessere").send({
      beneficiarioId: beneficiary.id,
      dataScadenza: "2027-12-31",
    });
    expect(card.status).toBe(201);
    expect(card.body.codice).toMatch(/^MS-[A-Za-z0-9_-]+$/);
    expect(card.body.codice).not.toBe(beneficiary.codice);
    expect(card.body.codice).not.toContain(beneficiary.codice);
    expect(card.body.codice).not.toContain("Storico");
    expect(card.body.codice).not.toContain("Mensa");
    const revoked = await request(app)
      .post(`/mensa/tessere/${card.body.id}/stato`)
      .send({
        stato: "revocata",
        motivo: "Tessera smarrita",
        versione: card.body.versione,
      });
    expect(revoked.status).toBe(200);
    expect(revoked.body.stato).toBe("revocata");

    const history = await request(app).get(
      `/mensa/abilitazioni?beneficiarioId=${beneficiary.id}`,
    );
    expect(history.body).toEqual([
      expect.objectContaining({ id: eligibility.body.id, stato: "sospesa" }),
    ]);
  });

  it("applica le transizioni terminali di Tessere e Abilitazioni", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const [card] = await db
      .select({ versione: tessereBeneficiariTable.updatedAt })
      .from(tessereBeneficiariTable)
      .where(eq(tessereBeneficiariTable.id, fixture.cardId));
    const missingCardReason = await request(app)
      .post(`/mensa/tessere/${fixture.cardId}/stato`)
      .send({ stato: "sospesa", versione: card.versione.toISOString() });
    expect(missingCardReason.status).toBe(400);
    const suspendedCard = await request(app)
      .post(`/mensa/tessere/${fixture.cardId}/stato`)
      .send({
        stato: "sospesa",
        motivo: "Verifica temporanea",
        versione: card.versione.toISOString(),
      });
    expect(suspendedCard.status).toBe(200);
    const activeCard = await request(app)
      .post(`/mensa/tessere/${fixture.cardId}/stato`)
      .send({ stato: "attiva", versione: suspendedCard.body.versione });
    expect(activeCard.status).toBe(200);
    const expiredCard = await request(app)
      .post(`/mensa/tessere/${fixture.cardId}/stato`)
      .send({ stato: "scaduta", versione: activeCard.body.versione });
    expect(expiredCard.status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/mensa/tessere/${fixture.cardId}/stato`)
          .send({ stato: "attiva", versione: expiredCard.body.versione })
      ).status,
    ).toBe(409);

    const [eligibility] = await db
      .select({ versione: mensaAbilitazioniTable.updatedAt })
      .from(mensaAbilitazioniTable)
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));
    expect(
      (
        await request(app)
          .post(`/mensa/abilitazioni/${fixture.eligibilityId}/stato`)
          .send({
            stato: "sospesa",
            versione: eligibility.versione.toISOString(),
          })
      ).status,
    ).toBe(400);
    const suspendedEligibility = await request(app)
      .post(`/mensa/abilitazioni/${fixture.eligibilityId}/stato`)
      .send({
        stato: "sospesa",
        motivo: "Verifica documentale",
        versione: eligibility.versione.toISOString(),
      });
    expect(suspendedEligibility.status).toBe(200);
    const activeEligibilityResponse = await request(app)
      .post(`/mensa/abilitazioni/${fixture.eligibilityId}/stato`)
      .send({
        stato: "attiva",
        versione: suspendedEligibility.body.versione,
      });
    expect(activeEligibilityResponse.status).toBe(200);
    const revokedEligibility = await request(app)
      .post(`/mensa/abilitazioni/${fixture.eligibilityId}/stato`)
      .send({
        stato: "revocata",
        motivo: "Revoca definitiva",
        versione: activeEligibilityResponse.body.versione,
      });
    expect(revokedEligibility.status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/mensa/abilitazioni/${fixture.eligibilityId}/stato`)
          .send({
            stato: "attiva",
            versione: revokedEligibility.body.versione,
          })
      ).status,
    ).toBe(409);
  });

  it("rende accesso e pasto idempotenti, blocca il secondo pasto e protegge l'override", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const accessKey = `same-${rnd()}`;
    const firstAccess = await verify(app, fixture, {
      idempotencyKey: accessKey,
    });
    const replayAccess = await verify(app, fixture, {
      idempotencyKey: accessKey,
    });
    expect(replayAccess.body.id).toBe(firstAccess.body.id);
    expect(replayAccess.body.idempotentReplay).toBe(true);

    const mealKey = `meal-${rnd()}`;
    const meal = await request(app).post("/mensa/pasti").send({
      accessoMensaId: firstAccess.body.id,
      tipoServizio: "pranzo",
      idempotencyKey: mealKey,
    });
    expect(meal.status).toBe(201);
    const replayMeal = await request(app).post("/mensa/pasti").send({
      accessoMensaId: firstAccess.body.id,
      tipoServizio: "pranzo",
      idempotencyKey: mealKey,
    });
    expect(replayMeal.body.id).toBe(meal.body.id);

    const secondAccess = await verify(app, fixture);
    const duplicate = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: secondAccess.body.id,
        tipoServizio: "pranzo",
        idempotencyKey: `meal-${rnd()}`,
      });
    expect(duplicate.status).toBe(409);

    const noOverride = MENSA_PERMISSIONS.map((item) => item.key).filter(
      (key) => key !== "mensa.meals.override",
    );
    const thirdAccess = await verify(makeApp(fixture, noOverride), fixture);
    const forbidden = await request(makeApp(fixture, noOverride))
      .post("/mensa/pasti")
      .send({
        accessoMensaId: thirdAccess.body.id,
        tipoServizio: "pranzo",
        override: true,
        motivoOverride: "Necessità documentata",
        idempotencyKey: `meal-${rnd()}`,
      });
    expect(forbidden.status).toBe(403);

    const fourthAccess = await verify(app, fixture);
    const override = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: fourthAccess.body.id,
        tipoServizio: "pranzo",
        override: true,
        motivoOverride: "Necessità documentata",
        idempotencyKey: `meal-${rnd()}`,
      });
    expect(override.status).toBe(201);
    expect(override.body.override).toBe(true);
    const audits = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(
        eq(auditConfigurazioniTable.chiave, `mensa-pasto:${override.body.id}`),
      );
    expect(audits).toHaveLength(1);
  });

  it("crea una persona provvisoria e un accesso temporaneo senza tessera o abilitazione permanente", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const key = `temporary-new-${rnd()}`;
    const first = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        idempotencyKey: key,
        motivo: "Persona priva di presa in carico permanente",
        nuovaPersona: {
          nome: `Nuovo${rnd()}`,
          cognome: `Temporaneo${rnd()}`,
          sesso: "M",
          fasciaEtaPresunta: "30_64",
          allergie: "lattosio",
        },
      });
    expect(first.status).toBe(201);
    expect(first.body.esito).toBe("consentito");
    expect(first.body.modalitaAccesso).toBe("temporaneo");
    expect(first.body.temporaneo).toBe(true);
    const createdId = Number(first.body.beneficiarioId);
    ids.beneficiaries.push(createdId);

    const [created] = await db
      .select()
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, createdId));
    expect(created.statoAnagrafica).toBe("provvisoria");
    expect(created.areaOperativaId).toBe(fixture.romeId);
    expect(created.centroAscoltoId).toBeNull();
    expect(created.uds).toBe(false);
    expect(
      await activeEligibility(createdId, dataServizioMensa(new Date())),
    ).toBeNull();
    expect(
      await db
        .select()
        .from(tessereBeneficiariTable)
        .where(eq(tessereBeneficiariTable.beneficiarioId, createdId)),
    ).toHaveLength(0);

    const meal = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: first.body.id,
        tipoServizio: "pranzo",
        idempotencyKey: `meal-temp-${rnd()}`,
      });
    expect(meal.status).toBe(201);
    const replay = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        idempotencyKey: key,
        nuovaPersona: {
          nome: "Non deve",
          cognome: "Duplicare",
          sesso: "F",
          fasciaEtaPresunta: "18_29",
        },
      });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.idempotentReplay).toBe(true);
  });

  it("autorizza separatamente pranzo e cena temporanei nella stessa data", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const [beneficiary] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BEN-2S-${rnd()}`,
        nome: "Doppio",
        cognome: "Servizio",
        areaOperativaId: fixture.romeId,
        attivo: true,
      })
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(beneficiary.id);

    const lunchKey = `temp-lunch-${rnd()}`;
    const lunch = await request(app).post("/mensa/accessi/temporaneo").send({
      mensaId: fixture.mensaA,
      beneficiarioId: beneficiary.id,
      tipoServizio: "pranzo",
      motivo: "Autorizzazione pranzo",
      idempotencyKey: lunchKey,
    });
    expect(lunch.status).toBe(201);
    const lunchReplay = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: beneficiary.id,
        tipoServizio: "pranzo",
        motivo: "Non duplica",
        idempotencyKey: lunchKey,
      });
    expect(lunchReplay.status).toBe(200);
    expect(lunchReplay.body.id).toBe(lunch.body.id);

    const duplicateLunch = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: beneficiary.id,
        tipoServizio: "pranzo",
        motivo: "Seconda autorizzazione pranzo",
        idempotencyKey: `temp-lunch-duplicate-${rnd()}`,
      });
    expect(duplicateLunch.status).toBe(409);

    const dinner = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: beneficiary.id,
        tipoServizio: "cena",
        motivo: "Autorizzazione cena",
        idempotencyKey: `temp-dinner-${rnd()}`,
      });
    expect(dinner.status).toBe(201);
    expect(
      (
        await request(app)
          .post("/mensa/pasti")
          .send({
            accessoMensaId: lunch.body.id,
            tipoServizio: "cena",
            idempotencyKey: `wrong-service-${rnd()}`,
          })
      ).status,
    ).toBe(409);

    for (const [accessoMensaId, tipoServizio] of [
      [lunch.body.id, "pranzo"],
      [dinner.body.id, "cena"],
    ] as const) {
      expect(
        (
          await request(app)
            .post("/mensa/pasti")
            .send({
              accessoMensaId,
              tipoServizio,
              idempotencyKey: `meal-${tipoServizio}-${rnd()}`,
            })
        ).status,
      ).toBe(201);
    }
    const authorizations = await db
      .select({ tipoServizio: mensaAutorizzazioniTemporaneeTable.tipoServizio })
      .from(mensaAutorizzazioniTemporaneeTable)
      .where(
        eq(mensaAutorizzazioniTemporaneeTable.beneficiarioId, beneficiary.id),
      );
    expect(authorizations.map((row) => row.tipoServizio).sort()).toEqual([
      "cena",
      "pranzo",
    ]);

    const report = await request(app).get(
      `/mensa/report?dal=${dataServizioMensa()}&al=${dataServizioMensa()}&mensaId=${fixture.mensaA}`,
    );
    expect(report.status).toBe(200);
    expect(report.body.accessiOrdinari).toBe(0);
    expect(report.body.accessiTemporanei).toBe(2);
    expect(report.body.pastiOrdinari).toBe(0);
    expect(report.body.pastiTemporanei).toBe(2);
  });

  it("nega gli accessi dopo la chiusura del solo servizio interessato", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const lunch = await verify(app, fixture, { tipoServizio: "pranzo" });
    expect(lunch.status).toBe(201);
    expect(
      (
        await request(app)
          .post("/mensa/pasti")
          .send({
            accessoMensaId: lunch.body.id,
            tipoServizio: "pranzo",
            idempotencyKey: `meal-close-${rnd()}`,
          })
      ).status,
    ).toBe(201);
    const days = await request(app).get(
      `/mensa/giornate?mensaId=${fixture.mensaA}&data=${dataServizioMensa()}`,
    );
    const lunchDay = days.body.find(
      (day: { tipoServizio: string }) => day.tipoServizio === "pranzo",
    );
    expect(
      (
        await request(app)
          .post(`/mensa/giornate/${lunchDay.id}/chiudi`)
          .send({ note: "Chiusura pranzo" })
      ).status,
    ).toBe(200);

    const deniedNormal = await verify(app, fixture, {
      tipoServizio: "pranzo",
    });
    expect(deniedNormal.status).toBe(201);
    expect(deniedNormal.body).toMatchObject({
      esito: "negato",
      motivoEsito: "SERVIZIO_CHIUSO",
      beneficiarioId: fixture.beneficiaryId,
      beneficiarioNome: "Mario Rossi",
      mensaPrincipaleId: fixture.mensaA,
      statoAbilitazione: "attiva",
      restrizioniAlimentari: "senza glutine",
      allergie: "arachidi",
    });

    const crossAreaKey = `closed-cross-area-${rnd()}`;
    const deniedCrossArea = await verify(app, fixture, {
      codiceTessera: fixture.milanCardCode,
      tipoServizio: "pranzo",
      idempotencyKey: crossAreaKey,
    });
    expect(deniedCrossArea.status).toBe(201);
    expect(deniedCrossArea.body).toMatchObject({
      esito: "negato",
      motivoEsito: "SERVIZIO_CHIUSO",
      beneficiarioId: null,
      beneficiarioNome: null,
      beneficiarioCodice: null,
      mensaPrincipaleId: null,
      mensaPrincipaleNome: null,
      statoAbilitazione: null,
      restrizioniAlimentari: null,
      allergie: null,
      eccezionePossibile: false,
    });
    const replayCrossArea = await verify(app, fixture, {
      codiceTessera: fixture.cardCode,
      tipoServizio: "pranzo",
      idempotencyKey: crossAreaKey,
    });
    expect(replayCrossArea.status).toBe(200);
    expect(replayCrossArea.body).toMatchObject({
      id: deniedCrossArea.body.id,
      idempotentReplay: true,
      motivoEsito: "SERVIZIO_CHIUSO",
      beneficiarioId: null,
      beneficiarioNome: null,
      beneficiarioCodice: null,
      mensaPrincipaleId: null,
      mensaPrincipaleNome: null,
      statoAbilitazione: null,
      restrizioniAlimentari: null,
      allergie: null,
      eccezionePossibile: false,
    });

    const [temporaryBeneficiary] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BEN-CLOSED-${rnd()}`,
        nome: "Arrivo",
        cognome: "Tardivo",
        areaOperativaId: fixture.romeId,
      })
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(temporaryBeneficiary.id);
    const deniedTemporary = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: temporaryBeneficiary.id,
        tipoServizio: "pranzo",
        motivo: "Arrivo dopo chiusura",
        idempotencyKey: `closed-temp-${rnd()}`,
      });
    expect(deniedTemporary.status).toBe(201);
    expect(deniedTemporary.body).toMatchObject({
      esito: "negato",
      motivoEsito: "SERVIZIO_CHIUSO",
    });
    expect(
      await db
        .select()
        .from(mensaAutorizzazioniTemporaneeTable)
        .where(
          eq(
            mensaAutorizzazioniTemporaneeTable.beneficiarioId,
            temporaryBeneficiary.id,
          ),
        ),
    ).toHaveLength(0);

    const beneficiariesBefore = await db
      .select({ id: beneficiariTable.id })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.areaOperativaId, fixture.romeId));
    const deniedNewPerson = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        tipoServizio: "pranzo",
        motivo: "Arrivo provvisorio dopo chiusura",
        idempotencyKey: `closed-new-person-${rnd()}`,
        nuovaPersona: {
          nome: `Chiuso${rnd()}`,
          cognome: `Provvisorio${rnd()}`,
          sesso: "ND",
          fasciaEtaPresunta: "30_64",
        },
      });
    expect(deniedNewPerson.status).toBe(201);
    expect(deniedNewPerson.body).toMatchObject({
      esito: "negato",
      motivoEsito: "SERVIZIO_CHIUSO",
      beneficiarioId: null,
    });
    const beneficiariesAfter = await db
      .select({ id: beneficiariTable.id })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.areaOperativaId, fixture.romeId));
    expect(beneficiariesAfter).toHaveLength(beneficiariesBefore.length);

    const dinner = await verify(app, fixture, { tipoServizio: "cena" });
    expect(dinner.status).toBe(201);
    expect(dinner.body.esito).toBe("consentito");
    expect(
      (
        await request(app)
          .post("/mensa/pasti")
          .send({
            accessoMensaId: deniedNormal.body.id,
            tipoServizio: "pranzo",
            idempotencyKey: `closed-denied-meal-${rnd()}`,
          })
      ).status,
    ).toBe(409);
  });

  it("crea una persona provvisoria anche con il servizio Centro di Ascolto disabilitato", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    await updateModuloAmbiente("CENTRO_ASCOLTO", false, null);

    try {
      const response = await request(app)
        .post("/mensa/accessi/temporaneo")
        .send({
          mensaId: fixture.mensaA,
          idempotencyKey: `temporary-no-centro-${rnd()}`,
          motivo: "Persona senza presa in carico del Centro di Ascolto",
          nuovaPersona: {
            nome: `Nuovo${rnd()}`,
            cognome: `Mensa${rnd()}`,
            sesso: "F",
            fasciaEtaPresunta: "30_64",
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.temporaneo).toBe(true);
      ids.beneficiaries.push(Number(response.body.beneficiarioId));
      const [created] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, Number(response.body.beneficiarioId)));
      expect(created.statoAnagrafica).toBe("provvisoria");
      expect(created.centroAscoltoId).toBeNull();
    } finally {
      await updateModuloAmbiente("CENTRO_ASCOLTO", true, null);
    }
  });

  it("continua a verificare accessi quando il servizio Magazzino Solidale è disabilitato", async () => {
    const fixture = await createFixture();
    await updateModuloAmbiente("MAGAZZINO_SOLIDALE", false, null);

    try {
      const response = await verify(makeApp(fixture), fixture);
      expect(response.status).toBe(201);
      expect(response.body.esito).toBe("consentito");
    } finally {
      await updateModuloAmbiente("MAGAZZINO_SOLIDALE", true, null);
    }
  });

  it("impone la conferma dei duplicati e permette di scegliere un esistente senza abilitazione", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const duplicate = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        idempotencyKey: `duplicate-${rnd()}`,
        nuovaPersona: {
          nome: "Mario",
          cognome: "Rossi",
          sesso: "M",
          fasciaEtaPresunta: "30_64",
        },
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.possibiliDuplicati).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.beneficiaryId }),
      ]),
    );

    const [existing] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BEN-TEMP-${rnd()}`,
        nome: "Esistente",
        cognome: "Senza Abilitazione",
        sesso: "F",
        areaOperativaId: fixture.romeId,
      })
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(existing.id);
    const allowed = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: existing.id,
        motivo: "Accesso straordinario documentato",
        idempotencyKey: `existing-${rnd()}`,
      });
    expect(allowed.status).toBe(201);
    expect(allowed.body.beneficiarioId).toBe(existing.id);
    expect(allowed.body.temporaneo).toBe(true);

    const normalTomorrowIndependentCheck = await request(app)
      .post("/mensa/accessi/verifica")
      .send({
        mensaId: fixture.mensaA,
        modalitaAccesso: "manuale",
        beneficiarioId: existing.id,
        idempotencyKey: `normal-${rnd()}`,
      });
    expect(normalTomorrowIndependentCheck.status).toBe(201);
    expect(normalTomorrowIndependentCheck.body.esito).toBe("negato");
    expect(normalTomorrowIndependentCheck.body.motivoEsito).toBe(
      "ABILITAZIONE_NON_PRESENTE",
    );
  });

  it("consente l'accesso temporaneo dopo un'abilitazione temporalmente scaduta", async () => {
    const fixture = await createFixture();
    const today = dataServizioMensa();
    await db
      .update(mensaAbilitazioniTable)
      .set({ dataFine: shiftDate(today, -1), stato: "attiva" })
      .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));
    const response = await request(makeApp(fixture))
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: fixture.beneficiaryId,
        motivo: "Abilitazione precedente scaduta",
        idempotencyKey: `expired-${rnd()}`,
      });
    expect(response.status).toBe(201);
    expect(response.body.temporaneo).toBe(true);
  });

  it.each(["sospesa", "revocata"] as const)(
    "nega l'accesso temporaneo con abilitazione %s",
    async (stato) => {
      const fixture = await createFixture();
      await db
        .update(mensaAbilitazioniTable)
        .set({ stato })
        .where(eq(mensaAbilitazioniTable.id, fixture.eligibilityId));
      const response = await request(makeApp(fixture))
        .post("/mensa/accessi/temporaneo")
        .send({
          mensaId: fixture.mensaA,
          beneficiarioId: fixture.beneficiaryId,
          motivo: "Tentativo non autorizzato",
          idempotencyKey: `${stato}-${rnd()}`,
        });
      expect(response.status).toBe(409);
      expect(response.body.error).toContain(stato);
    },
  );

  it("indirizza al flusso ordinario una persona con abilitazione valida", async () => {
    const fixture = await createFixture();
    const response = await request(makeApp(fixture))
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: fixture.beneficiaryId,
        motivo: "Tentativo temporaneo",
        idempotencyKey: `valid-${rnd()}`,
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("abilitazione Mensa valida");
  });

  it("protegge accessi temporanei con permesso dedicato e scope area operativa", async () => {
    const fixture = await createFixture();
    const noTemporary = MENSA_PERMISSIONS.map((item) => item.key).filter(
      (key) => key !== "mensa.access.temporary",
    );
    const forbidden = await request(makeApp(fixture, noTemporary))
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: fixture.beneficiaryId,
        idempotencyKey: `forbidden-${rnd()}`,
      });
    expect(forbidden.status).toBe(403);

    const crossAreaOperativa = await request(makeApp(fixture))
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: fixture.milanBeneficiaryId,
        motivo: "Tentativo fuori scope",
        idempotencyKey: `cross-areaOperativa-${rnd()}`,
      });
    expect(crossAreaOperativa.status).toBe(404);
    expect(crossAreaOperativa.body.error).toBe("Beneficiario non disponibile");
  });

  it("emette dal Sociale solo tessere opache e soltanto dopo il completamento dell'anagrafica", async () => {
    const fixture = await createFixture();
    const permissions = [
      ...MENSA_PERMISSIONS.map((item) => item.key),
      "beneficiari.cards.manage",
      "beneficiari.view",
      "beneficiari.manage",
    ];
    const app = makeApp(fixture, permissions);
    await db
      .update(beneficiariTable)
      .set({ statoAnagrafica: "provvisoria" })
      .where(eq(beneficiariTable.id, fixture.beneficiaryId));
    const provisional = await request(app)
      .post(`/beneficiari/${fixture.beneficiaryId}/tessere`)
      .send({ motivoSostituzione: "Test anagrafica provvisoria" });
    expect(provisional.status).toBe(409);
    expect(
      (
        await request(app).post("/mensa/tessere").send({
          beneficiarioId: fixture.beneficiaryId,
          motivoSostituzione: "Test emissione Mensa",
        })
      ).status,
    ).toBe(409);
    const toComplete = await request(app).get(
      "/beneficiari?statoAnagrafica=provvisoria",
    );
    expect(toComplete.status).toBe(200);
    expect(toComplete.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.beneficiaryId }),
      ]),
    );

    const incomplete = await request(app)
      .patch(`/beneficiari/${fixture.beneficiaryId}`)
      .send({ statoAnagrafica: "completa", versione: 1 });
    expect(incomplete.status).toBe(400);
    const [center] = await db
      .insert(centriAscoltoTable)
      .values({ nome: `Centro ${rnd()}`, areaOperativaId: fixture.romeId })
      .returning({ id: centriAscoltoTable.id });
    ids.centers.push(center.id);
    const completed = await request(app)
      .patch(`/beneficiari/${fixture.beneficiaryId}`)
      .send({
        statoAnagrafica: "completa",
        centroAscoltoId: center.id,
        sesso: "M",
        fasciaEtaPresunta: "30_64",
        versione: 1,
      });
    expect(completed.status).toBe(200);
    expect(completed.body.statoAnagrafica).toBe("completa");
    expect(completed.body.centroAscoltoId).toBe(center.id);
    const noLongerToComplete = await request(app).get(
      "/beneficiari?statoAnagrafica=provvisoria",
    );
    expect(noLongerToComplete.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.beneficiaryId }),
      ]),
    );
    const completionAudit = await db
      .select()
      .from(auditConfigurazioniTable)
      .where(
        eq(
          auditConfigurazioniTable.chiave,
          `beneficiario:${fixture.beneficiaryId}`,
        ),
      );
    expect(completionAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ azione: "completamento-anagrafica" }),
      ]),
    );
    const cards = await request(app).get(
      `/beneficiari/${fixture.beneficiaryId}/tessere`,
    );
    expect(cards.status).toBe(200);
    expect(cards.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ stato: "attiva" })]),
    );
    const issued = await request(app)
      .post(`/beneficiari/${fixture.beneficiaryId}/tessere`)
      .send({ motivoSostituzione: "Sostituzione tessera legacy" });
    expect(issued.status).toBe(201);
    expect(issued.body.codice).toMatch(/^MS-[A-Za-z0-9_-]+$/);
    expect(issued.body.codice).not.toContain("BEN-");
    expect(issued.body.codice).not.toContain("Mario");
    const cardHistory = await request(app).get(
      `/beneficiari/${fixture.beneficiaryId}/tessere`,
    );
    expect(cardHistory.status).toBe(200);
    expect(cardHistory.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: issued.body.id, stato: "attiva" }),
        expect.objectContaining({
          id: fixture.cardId,
          stato: "revocata",
          motivoRevoca: "Sostituzione tessera legacy",
        }),
      ]),
    );
  });

  it("rifiuta un pasto con accesso del giorno precedente e un'autorizzazione temporanea di altra data", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const access = await verify(app, fixture, { tipoServizio: "cena" });
    const today = dataServizioMensa();
    const yesterday = shiftDate(today, -1);
    await db
      .update(mensaAccessiTable)
      .set({ dataOra: new Date(`${yesterday}T12:00:00Z`) })
      .where(eq(mensaAccessiTable.id, access.body.id));
    const oldAccessMeal = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: access.body.id,
        tipoServizio: "cena",
        idempotencyKey: `old-access-${rnd()}`,
      });
    expect(oldAccessMeal.status).toBe(409);
    expect(oldAccessMeal.body.error).toContain("data di servizio corrente");

    const [existing] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BTD-${rnd()}`,
        nome: "Data",
        cognome: "Temporanea",
        sesso: "F",
        fasciaEtaPresunta: "30_64",
        areaOperativaId: fixture.romeId,
      })
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(existing.id);
    const temporary = await request(app)
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: existing.id,
        motivo: "Controllo data autorizzazione",
        tipoServizio: "cena",
        idempotencyKey: `temp-date-${rnd()}`,
      });
    expect(temporary.status).toBe(201);
    const [temporaryAccess] = await db
      .select({
        autorizzazioneTemporaneaId:
          mensaAccessiTable.autorizzazioneTemporaneaId,
      })
      .from(mensaAccessiTable)
      .where(eq(mensaAccessiTable.id, temporary.body.id));
    expect(temporaryAccess.autorizzazioneTemporaneaId).not.toBeNull();
    await db
      .update(mensaAutorizzazioniTemporaneeTable)
      .set({ dataServizio: yesterday })
      .where(
        eq(
          mensaAutorizzazioniTemporaneeTable.id,
          temporaryAccess.autorizzazioneTemporaneaId!,
        ),
      );
    const mismatchedAuthorization = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: temporary.body.id,
        tipoServizio: "cena",
        idempotencyKey: `temp-auth-date-${rnd()}`,
      });
    expect(mismatchedAuthorization.status).toBe(409);
    expect(mismatchedAuthorization.body.error).toContain(
      "autorizzazione temporanea",
    );
  });

  it("conta un beneficiario una sola volta nel report anche se servito in più Mense", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const firstAccess = await verify(app, fixture);
    expect(
      (
        await request(app)
          .post("/mensa/pasti")
          .send({
            accessoMensaId: firstAccess.body.id,
            tipoServizio: "pranzo",
            idempotencyKey: `meal-${rnd()}`,
          })
      ).status,
    ).toBe(201);
    const denied = await verify(app, fixture, {
      mensaId: fixture.mensaB,
      tipoServizio: "cena",
    });
    const exceptional = await request(app)
      .post(`/mensa/accessi/${denied.body.id}/eccezione`)
      .send({ motivo: "Servizio temporaneamente spostato" });
    expect(exceptional.status).toBe(200);
    expect(
      (
        await request(app)
          .post("/mensa/pasti")
          .send({
            accessoMensaId: exceptional.body.id,
            tipoServizio: "cena",
            idempotencyKey: `meal-${rnd()}`,
          })
      ).status,
    ).toBe(201);

    const today = dataServizioMensa(new Date());
    const report = await request(app).get(
      `/mensa/report?dal=${today}&al=${today}`,
    );
    expect(report.status).toBe(200);
    expect(report.body.totalePasti).toBe(2);
    expect(report.body.beneficiariDistinti).toBe(1);
    expect(report.body.distribuzione).toHaveLength(2);
    expect(report.body.distribuzioneTipoServizio).toEqual(
      expect.arrayContaining([
        { chiave: "pranzo", totale: 1 },
        { chiave: "cena", totale: 1 },
      ]),
    );
    expect(report.body.beneficiariDistintiPerSesso).toEqual([
      expect.objectContaining({ totale: 1 }),
    ]);
    const days = await request(app).get(
      `/mensa/giornate?mensaId=${fixture.mensaA}&data=${today}`,
    );
    const lunchDay = days.body.find(
      (item: { tipoServizio: string }) => item.tipoServizio === "pranzo",
    );
    const closedLunch = await request(app)
      .post(`/mensa/giornate/${lunchDay.id}/chiudi`)
      .send({ note: "Chiusura pranzo" });
    expect(closedLunch.status).toBe(200);
    expect(closedLunch.body.snapshot).toMatchObject({
      accessiOrdinari: 1,
      accessiEccezione: 0,
    });
  });

  it("aggrega nel report tutte le categorie storiche di sesso, fascia età e temporaneità", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const today = dataServizioMensa();
    const categories = [
      { sesso: "M", fascia: "0_17", temporaneo: false, tipo: "pranzo" },
      { sesso: "F", fascia: "18_29", temporaneo: true, tipo: "cena" },
      { sesso: "ALTRO", fascia: "30_64", temporaneo: false, tipo: "pranzo" },
      { sesso: "ND", fascia: "65_plus", temporaneo: true, tipo: "cena" },
      {
        sesso: "M",
        fascia: "non_determinata",
        temporaneo: false,
        tipo: "pranzo",
      },
    ] as const;
    const beneficiaries = await db
      .insert(beneficiariTable)
      .values(
        categories.map((_, index) => ({
          codice: `BEN-REPORT-${index}-${rnd()}`,
          nome: `Report${index}`,
          cognome: "Mensa",
          areaOperativaId: fixture.romeId,
          attivo: true,
        })),
      )
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(...beneficiaries.map((row) => row.id));
    const accesses = await db
      .insert(mensaAccessiTable)
      .values(
        categories.map((category, index) => ({
          mensaId: fixture.mensaA,
          beneficiarioId: beneficiaries[index].id,
          esito: "consentito",
          motivoEsito: "ABILITAZIONE_VALIDA",
          operatoreId: fixture.userId,
          modalitaAccesso: category.temporaneo ? "temporaneo" : "manuale",
          tipoServizio: category.tipo,
          idempotencyKey: `report-access-${index}-${rnd()}`,
        })),
      )
      .returning({ id: mensaAccessiTable.id });
    await db.insert(mensaPastiTable).values(
      categories.map((category, index) => ({
        mensaId: fixture.mensaA,
        beneficiarioId: beneficiaries[index].id,
        accessoMensaId: accesses[index].id,
        dataServizio: today,
        tipoServizio: category.tipo,
        sessoSnapshot: category.sesso,
        fasciaEtaSnapshot: category.fascia,
        fasciaEtaOrigineSnapshot:
          category.fascia === "non_determinata"
            ? "non_determinata"
            : "calcolata",
        anagraficaProvvisoriaSnapshot: false,
        temporaneoSnapshot: category.temporaneo,
        operatoreId: fixture.userId,
        idempotencyKey: `report-meal-${index}-${rnd()}`,
      })),
    );

    const report = await request(app).get(
      `/mensa/report?dal=${today}&al=${today}&mensaId=${fixture.mensaA}`,
    );
    expect(report.status).toBe(200);
    expect(report.body.totalePasti).toBe(5);
    expect(report.body.pastiTemporanei).toBe(2);
    expect(report.body.pastiOrdinari).toBe(3);
    expect(report.body.distribuzioneSesso).toEqual(
      expect.arrayContaining([
        { chiave: "M", totale: 2 },
        { chiave: "F", totale: 1 },
        { chiave: "ALTRO", totale: 1 },
        { chiave: "ND", totale: 1 },
      ]),
    );
    expect(report.body.distribuzioneFasciaEta).toEqual(
      expect.arrayContaining(
        categories.map((category) => ({
          chiave: category.fascia,
          totale: 1,
        })),
      ),
    );
    expect(report.body.distribuzioneTipoServizio).toEqual(
      expect.arrayContaining([
        { chiave: "pranzo", totale: 3 },
        { chiave: "cena", totale: 2 },
      ]),
    );
  });

  it("pagina senza limiti silenziosi Accessi, Pasti, Eccezioni e Trasferimenti", async () => {
    const fixture = await createFixture();
    const today = dataServizioMensa();
    const accesses = await db
      .insert(mensaAccessiTable)
      .values(
        Array.from({ length: 505 }, (_, index) => ({
          mensaId: fixture.mensaA,
          beneficiarioId: fixture.beneficiaryId,
          dataOra: new Date(`${shiftDate(today, -index)}T12:00:00Z`),
          esito: "consentito",
          motivoEsito: "CONSENTITO",
          operatoreId: fixture.userId,
          modalitaAccesso: "manuale",
          idempotencyKey: `page-access-${rnd()}-${index}`,
        })),
      )
      .returning({ id: mensaAccessiTable.id });
    await db.insert(mensaPastiTable).values(
      accesses.map((access, index) => ({
        mensaId: fixture.mensaA,
        beneficiarioId: fixture.beneficiaryId,
        accessoMensaId: access.id,
        dataServizio: shiftDate(today, -index),
        tipoServizio: "pranzo",
        operatoreId: fixture.userId,
        idempotencyKey: `page-meal-${rnd()}-${index}`,
      })),
    );
    await db.insert(mensaEccezioniTable).values(
      accesses.map((access, index) => ({
        beneficiarioId: fixture.beneficiaryId,
        mensaPrincipaleId: fixture.mensaA,
        mensaDestinazioneId: fixture.mensaB,
        areaOperativaId: fixture.romeId,
        motivo: `Eccezione paginata ${index}`,
        operatoreId: fixture.userId,
        accessoMensaId: access.id,
      })),
    );
    const transfers = await db
      .insert(trasferimentiTable)
      .values(
        Array.from({ length: 505 }, (_, index) => ({
          codice: `TR-PAGE-${rnd()}-${index}`,
          magazzinoOrigineId: fixture.warehouseIds[1],
          magazzinoDestinoId: fixture.warehouseIds[0],
          mensaId: fixture.mensaA,
          dataRichiesta: today,
          operatoreId: fixture.userId,
        })),
      )
      .returning({ id: trasferimentiTable.id });
    ids.transfers.push(...transfers.map((row) => row.id));

    const app = makeApp(fixture);
    for (const endpoint of [
      "/mensa/accessi",
      "/mensa/pasti",
      "/mensa/eccezioni",
      "/mensa/trasferimenti",
    ]) {
      const page = await request(app).get(`${endpoint}?page=11&pageSize=50`);
      expect(page.status, endpoint).toBe(200);
      expect(page.body, endpoint).toMatchObject({
        page: 11,
        pageSize: 50,
        total: 505,
      });
      expect(page.body.items, endpoint).toHaveLength(5);
    }
  });

  it("ammette periodi principali futuri disgiunti e rifiuta sovrapposizioni anche concorrenti", async () => {
    const fixture = await createFixture();
    const [beneficiary] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BPER-${rnd()}`,
        nome: "Periodi",
        cognome: "Disgiunti",
        sesso: "F",
        fasciaEtaPresunta: "30_64",
        areaOperativaId: fixture.romeId,
      })
      .returning({ id: beneficiariTable.id });
    ids.beneficiaries.push(beneficiary.id);
    const app = makeApp(fixture);
    const first = await request(app).post("/mensa/abilitazioni").send({
      beneficiarioId: beneficiary.id,
      mensaId: fixture.mensaA,
      dataInizio: "2027-01-01",
      dataFine: "2027-01-31",
    });
    expect(first.status).toBe(201);
    const sharedBoundary = await request(app).post("/mensa/abilitazioni").send({
      beneficiarioId: beneficiary.id,
      mensaId: fixture.mensaB,
      dataInizio: "2027-01-31",
      dataFine: "2027-02-10",
    });
    expect(sharedBoundary.status).toBe(409);
    const disjoint = await request(app).post("/mensa/abilitazioni").send({
      beneficiarioId: beneficiary.id,
      mensaId: fixture.mensaB,
      dataInizio: "2027-02-01",
      dataFine: "2027-02-28",
    });
    expect(disjoint.status).toBe(201);

    const concurrentBody = {
      beneficiarioId: beneficiary.id,
      dataInizio: "2027-03-01",
      dataFine: "2027-03-31",
    };
    const concurrent = await Promise.all([
      request(app)
        .post("/mensa/abilitazioni")
        .send({ ...concurrentBody, mensaId: fixture.mensaA }),
      request(app)
        .post("/mensa/abilitazioni")
        .send({ ...concurrentBody, mensaId: fixture.mensaB }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
  });

  it("normalizza i tipi servizio canonici e conserva lo snapshot storico", async () => {
    const fixture = await createFixture();
    await db
      .update(beneficiariTable)
      .set({
        sesso: "F",
        dataNascita: "2008-08-21",
        fasciaEtaPresunta: null,
        statoAnagrafica: "provvisoria",
      })
      .where(eq(beneficiariTable.id, fixture.beneficiaryId));
    const app = makeApp(fixture);
    const access = await verify(app, fixture);
    const valid = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: access.body.id,
        tipoServizio: " PRANZO ",
        idempotencyKey: `canonical-${rnd()}`,
      });
    expect(valid.status).toBe(201);
    expect(valid.body).toEqual(
      expect.objectContaining({
        tipoServizio: "pranzo",
        sessoSnapshot: "F",
        fasciaEtaSnapshot: "0_17",
        fasciaEtaOrigineSnapshot: "calcolata",
        anagraficaProvvisoriaSnapshot: true,
      }),
    );
    const invalidAccess = await verify(app, fixture);
    const invalid = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: invalidAccess.body.id,
        tipoServizio: "colazione",
        idempotencyKey: `invalid-service-${rnd()}`,
      });
    expect(invalid.status).toBe(400);

    const malformedAccess = await verify(app, fixture);
    const malformed = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: malformedAccess.body.id,
        tipoServizio: "pranzo2",
        idempotencyKey: `invalid-service-${rnd()}`,
      });
    expect(malformed.status).toBe(400);

    const dinnerAccess = await verify(app, fixture, {
      tipoServizio: "cena",
    });
    const dinner = await request(app)
      .post("/mensa/pasti")
      .send({
        accessoMensaId: dinnerAccess.body.id,
        tipoServizio: "cena",
        idempotencyKey: `canonical-dinner-${rnd()}`,
      });
    expect(dinner.status).toBe(201);
    expect(dinner.body.tipoServizio).toBe("cena");
  });

  it("rifiuta un consumo futuro senza modificare Lotto, Giornata o Movimenti", async () => {
    const fixture = await createFixture();
    const [product] = await db
      .insert(prodottiTable)
      .values({
        codice: `PFUT-${rnd()}`,
        nome: "Prodotto consumo futuro",
        tipoProdotto: "alimentare",
        unitaMisura: "kg",
        attivo: true,
      })
      .returning({ id: prodottiTable.id });
    ids.products.push(product.id);
    const [lot] = await db
      .insert(lottiTable)
      .values({
        prodottoId: product.id,
        codiceLotto: `LF-${rnd()}`,
        dataScadenza: "2027-12-31",
        dataCarico: dataServizioMensa(),
        quantitaCaricata: "8.00",
        quantitaResidua: "8.00",
        magazzinoId: fixture.warehouseIds[0],
      })
      .returning({ id: lottiTable.id });
    ids.lots.push(lot.id);
    const futureDate = shiftDate(dataServizioMensa(), 1);
    const response = await request(makeApp(fixture))
      .post("/mensa/consumi")
      .send({
        mensaId: fixture.mensaA,
        dataServizio: futureDate,
        tipoServizio: "pranzo",
        prodottoId: product.id,
        quantita: 2,
        causale: "consumo",
        idempotencyKey: `future-${rnd()}`,
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/non può essere futura/i);
    const [unchangedLot] = await db
      .select({ quantita: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lot.id));
    expect(Number(unchangedLot.quantita)).toBe(8);
    expect(
      await db
        .select()
        .from(mensaGiornateServizioTable)
        .where(eq(mensaGiornateServizioTable.dataServizio, futureDate)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.prodottoId, product.id)),
    ).toHaveLength(0);
  });

  it("espone e fotografa consumi multi-unit senza un totale cross-unit", async () => {
    const fixture = await createFixture();
    const app = makeApp(fixture);
    const today = dataServizioMensa();
    const inputs = [
      { nome: "Farina", unitaMisura: "kg", quantita: 10 },
      { nome: "Piatti", unitaMisura: "pz", quantita: 20 },
      { nome: "Pasta", unitaMisura: "kg", quantita: 5 },
    ];
    let firstProductId: number | null = null;
    for (const input of inputs) {
      const [product] = await db
        .insert(prodottiTable)
        .values({
          codice: `PMU-${rnd()}`,
          nome: `${input.nome} ${rnd()}`,
          tipoProdotto: "alimentare",
          unitaMisura: input.unitaMisura,
          attivo: true,
        })
        .returning({ id: prodottiTable.id });
      firstProductId ??= product.id;
      ids.products.push(product.id);
      const [lot] = await db
        .insert(lottiTable)
        .values({
          prodottoId: product.id,
          codiceLotto: `LMU-${rnd()}`,
          dataScadenza: "2027-12-31",
          dataCarico: today,
          quantitaCaricata: input.quantita.toFixed(2),
          quantitaResidua: input.quantita.toFixed(2),
          magazzinoId: fixture.warehouseIds[0],
        })
        .returning({ id: lottiTable.id });
      ids.lots.push(lot.id);
      const response = await request(app)
        .post("/mensa/consumi")
        .send({
          mensaId: fixture.mensaA,
          dataServizio: today,
          tipoServizio: "pranzo",
          prodottoId: product.id,
          quantita: input.quantita,
          causale: "consumo",
          idempotencyKey: `multi-unit-${rnd()}`,
        });
      expect(response.status).toBe(201);
      ids.consumptions.push(response.body.id);
      ids.issues.push(response.body.scaricoId);
    }

    await db
      .update(prodottiTable)
      .set({ unitaMisura: "pz" })
      .where(eq(prodottiTable.id, firstProductId!));

    const report = await request(app).get(
      `/mensa/report?dal=${today}&al=${today}&mensaId=${fixture.mensaA}&tipoServizio=pranzo`,
    );
    expect(report.status).toBe(200);
    expect(report.body.consumiPerUnitaMisura).toEqual([
      { unitaMisura: "kg", quantita: 15 },
      { unitaMisura: "pz", quantita: 20 },
    ]);
    expect(report.body.consumiPerProdotto).toHaveLength(3);
    expect(report.body).not.toHaveProperty("consumoTotale");

    const days = await request(app).get(
      `/mensa/giornate?mensaId=${fixture.mensaA}&data=${today}`,
    );
    const lunchDay = days.body.find(
      (day: { tipoServizio: string }) => day.tipoServizio === "pranzo",
    );
    const closed = await request(app)
      .post(`/mensa/giornate/${lunchDay.id}/chiudi`)
      .send({ note: "Snapshot multi-unit" });
    expect(closed.status).toBe(200);
    expect(closed.body.snapshot.consumiPerUnitaMisura).toEqual([
      { unitaMisura: "kg", quantita: 15 },
      { unitaMisura: "pz", quantita: 20 },
    ]);
    expect(closed.body.snapshot).not.toHaveProperty("consumoTotale");
  });

  it("registra consumo FEFO idempotente, rollback insufficiente, chiusura, riapertura e storno compensativo", async () => {
    const fixture = await createFixture();
    const [product] = await db
      .insert(prodottiTable)
      .values({
        codice: `PCON-${rnd()}`,
        nome: "Prodotto consumo Mensa",
        tipoProdotto: "alimentare",
        unitaMisura: "kg",
        attivo: true,
      })
      .returning({ id: prodottiTable.id });
    ids.products.push(product.id);
    const lots = await db
      .insert(lottiTable)
      .values([
        {
          prodottoId: product.id,
          codiceLotto: `L1-${rnd()}`,
          dataScadenza: "2027-01-10",
          dataCarico: "2026-08-01",
          quantitaCaricata: "2.00",
          quantitaResidua: "2.00",
          magazzinoId: fixture.warehouseIds[0],
        },
        {
          prodottoId: product.id,
          codiceLotto: `L2-${rnd()}`,
          dataScadenza: "2027-02-10",
          dataCarico: "2026-08-02",
          quantitaCaricata: "3.00",
          quantitaResidua: "3.00",
          magazzinoId: fixture.warehouseIds[0],
        },
      ])
      .returning({ id: lottiTable.id });
    ids.lots.push(...lots.map((lot) => lot.id));
    const app = makeApp(fixture);
    const today = dataServizioMensa();
    const key = `consumption-${rnd()}`;
    const first = await request(app).post("/mensa/consumi").send({
      mensaId: fixture.mensaA,
      dataServizio: today,
      tipoServizio: "pranzo",
      prodottoId: product.id,
      quantita: 4,
      causale: "consumo",
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);
    ids.consumptions.push(first.body.id);
    ids.issues.push(first.body.scaricoId);
    const residuals = await db
      .select({ id: lottiTable.id, quantity: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(
        inArray(
          lottiTable.id,
          lots.map((lot) => lot.id),
        ),
      )
      .orderBy(asc(lottiTable.id));
    expect(residuals.map((lot) => Number(lot.quantity))).toEqual([0, 1]);

    const replay = await request(app).post("/mensa/consumi").send({
      mensaId: fixture.mensaA,
      dataServizio: today,
      tipoServizio: "pranzo",
      prodottoId: product.id,
      quantita: 4,
      causale: "consumo",
      idempotencyKey: key,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);

    const insufficient = await request(app)
      .post("/mensa/consumi")
      .send({
        mensaId: fixture.mensaA,
        dataServizio: today,
        tipoServizio: "pranzo",
        prodottoId: product.id,
        quantita: 2,
        causale: "consumo",
        idempotencyKey: `insufficient-${rnd()}`,
      });
    expect(insufficient.status).toBe(409);
    const [lastLot] = await db
      .select({ quantity: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lots[1].id));
    expect(Number(lastLot.quantity)).toBe(1);

    const days = await request(app).get(
      `/mensa/giornate?mensaId=${fixture.mensaA}&data=${today}`,
    );
    const day = days.body.find(
      (item: { tipoServizio: string }) => item.tipoServizio === "pranzo",
    );
    expect(
      (
        await request(app)
          .post(`/mensa/giornate/${day.id}/chiudi`)
          .send({ note: "Fine servizio" })
      ).status,
    ).toBe(200);
    const afterClose = await request(app)
      .post("/mensa/consumi")
      .send({
        mensaId: fixture.mensaA,
        dataServizio: today,
        tipoServizio: "pranzo",
        prodottoId: product.id,
        quantita: 0.5,
        causale: "scarto",
        idempotencyKey: `closed-${rnd()}`,
      });
    expect(afterClose.status).toBe(409);
    expect(
      (
        await request(app)
          .post(`/mensa/giornate/${day.id}/riapri`)
          .send({ motivo: "Correzione conteggio" })
      ).status,
    ).toBe(200);
    const waste = await request(app)
      .post("/mensa/consumi")
      .send({
        mensaId: fixture.mensaA,
        dataServizio: today,
        tipoServizio: "pranzo",
        prodottoId: product.id,
        quantita: 0.5,
        causale: "scarto",
        idempotencyKey: `waste-${rnd()}`,
      });
    expect(waste.status).toBe(201);
    ids.consumptions.push(waste.body.id);
    ids.issues.push(waste.body.scaricoId);
    expect(
      (
        await request(app)
          .post(`/mensa/consumi/${waste.body.id}/storno`)
          .send({ motivo: "Errore di pesatura" })
      ).status,
    ).toBe(200);
    const [restored] = await db
      .select({ quantity: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lots[1].id));
    expect(Number(restored.quantity)).toBe(1);
  });
});
