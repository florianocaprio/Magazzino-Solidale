import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  cittaTable,
  db,
  magazziniTable,
  mensaAbilitazioniTable,
  mensaAccessiTable,
  mensaAutorizzazioniTemporaneeTable,
  mensaEccezioniTable,
  mensaPastiTable,
  menseTable,
  pool,
  tessereBeneficiariTable,
  trasferimentiTable,
  utentiTable,
} from "@workspace/db";
import mensaRouter, { activeEligibility } from "../src/routes/mensa";
import beneficiariRouter from "../src/routes/beneficiari";
import trasferimentiRouter from "../src/routes/trasferimenti";
import {
  ensureAmbienteModuli,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";
import { MENSA_PERMISSIONS } from "../src/lib/permissions";
import { dataServizioMensa } from "../src/lib/mensaWorkflow";

const ids = {
  users: [] as number[],
  cities: [] as number[],
  warehouses: [] as number[],
  beneficiaries: [] as number[],
  canteens: [] as number[],
  transfers: [] as number[],
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
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: fixture.userId,
      cittaId: fixture.romeId,
      centroAscoltoId: null,
      isAdmin: false,
      isSuperAdmin: false,
      aree: ["mensa"],
      permessi: permissions,
      mustChangePassword: false,
    } as NonNullable<typeof req.user>;
    next();
  });
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
    .insert(cittaTable)
    .values({ nome: `Roma ${rnd()}` })
    .returning({ id: cittaTable.id });
  const [milan] = await db
    .insert(cittaTable)
    .values({ nome: `Milano ${rnd()}` })
    .returning({ id: cittaTable.id });
  ids.cities.push(rome.id, milan.id);
  const warehouses = await db
    .insert(magazziniTable)
    .values([
      {
        codice: `MR1-${rnd()}`,
        nome: "Mensa Roma A",
        cittaId: rome.id,
        tipoMagazzino: "mensa",
      },
      {
        codice: `MR2-${rnd()}`,
        nome: "Mensa Roma B",
        cittaId: rome.id,
        tipoMagazzino: "mensa",
      },
      {
        codice: `MM1-${rnd()}`,
        nome: "Mensa Milano",
        cittaId: milan.id,
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
        cittaId: rome.id,
        magazzinoId: warehouses[0].id,
        createdBy: user.id,
      },
      {
        codice: `M-B-${rnd()}`,
        nome: "Roma B",
        cittaId: rome.id,
        magazzinoId: warehouses[1].id,
        createdBy: user.id,
      },
      {
        codice: `M-M-${rnd()}`,
        nome: "Milano",
        cittaId: milan.id,
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
      cittaId: rome.id,
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
      cittaId: milan.id,
      attivo: true,
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
      idempotencyKey: `access-${rnd()}`,
      ...values,
    });
}

beforeAll(async () => {
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
      .delete(trasferimentiTable)
      .where(inArray(trasferimentiTable.id, ids.transfers.splice(0)));
  if (ids.beneficiaries.length)
    await db
      .delete(mensaPastiTable)
      .where(inArray(mensaPastiTable.beneficiarioId, ids.beneficiaries));
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
  if (ids.warehouses.length)
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, ids.warehouses.splice(0)));
  if (ids.users.length)
    await db
      .delete(utentiTable)
      .where(inArray(utentiTable.id, ids.users.splice(0)));
  if (ids.cities.length)
    await db
      .delete(cittaTable)
      .where(inArray(cittaTable.id, ids.cities.splice(0)));
});

afterAll(async () => {
  await pool.end();
});

describe("Modulo Mensa", () => {
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

  it("gestisce più Mense nella stessa città e non espone quelle di altre città", async () => {
    const fixture = await createFixture();
    const response = await request(makeApp(fixture)).get("/mensa/mense");
    expect(response.status).toBe(200);
    expect(response.body.map((row: { id: number }) => row.id).sort()).toEqual(
      [fixture.mensaA, fixture.mensaB].sort(),
    );
  });

  it("nega anche dalle route logistiche generiche i trasferimenti Mensa di un'altra città", async () => {
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

  it("associa solo magazzini Mensa attivi e non riconverte magazzini logistici", async () => {
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

    const [emporioWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `EMP-${rnd()}`,
        nome: "Emporio esistente",
        cittaId: fixture.romeId,
        tipoMagazzino: "emporio",
      })
      .returning({ id: magazziniTable.id });
    ids.warehouses.push(emporioWarehouse.id);
    const response = await request(makeApp(fixture))
      .post("/mensa/mense")
      .send({
        codice: `MENSA-${rnd()}`,
        nome: "Mensa non valida",
        magazzinoId: emporioWarehouse.id,
      });
    expect(response.status).toBe(409);
    const [unchanged] = await db
      .select({ tipoMagazzino: magazziniTable.tipoMagazzino })
      .from(magazziniTable)
      .where(eq(magazziniTable.id, emporioWarehouse.id));
    expect(unchanged.tipoMagazzino).toBe("emporio");

    const [logisticsWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `LOG-${rnd()}`,
        nome: "Magazzino centrale logistico",
        cittaId: fixture.romeId,
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
    expect(logisticsResponse.status).toBe(409);
    const [logisticsUnchanged] = await db
      .select({ tipoMagazzino: magazziniTable.tipoMagazzino })
      .from(magazziniTable)
      .where(eq(magazziniTable.id, logisticsWarehouse.id));
    expect(logisticsUnchanged.tipoMagazzino).toBe("logistico");

    const [inactiveWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `MEN-INACTIVE-${rnd()}`,
        nome: "Magazzino Mensa inattivo",
        cittaId: fixture.romeId,
        tipoMagazzino: "mensa",
        stato: "inattivo",
      })
      .returning({ id: magazziniTable.id });
    ids.warehouses.push(inactiveWarehouse.id);
    const inactiveResponse = await request(makeApp(fixture))
      .post("/mensa/mense")
      .send({
        codice: `MENSA-INACTIVE-${rnd()}`,
        nome: "Mensa inattiva",
        magazzinoId: inactiveWarehouse.id,
      });
    expect(inactiveResponse.status).toBe(409);
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

  it("esclude i magazzini senza città dallo scope logistico territoriale", async () => {
    const fixture = await createFixture();
    const [legacyWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `LEG-${rnd()}`,
        nome: "Magazzino legacy senza città",
        cittaId: null,
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

  it("propone e registra un'eccezione esplicita soltanto tra Mense della stessa città", async () => {
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

  it("nega l'altra città e non restituisce identità o informazioni alimentari", async () => {
    const fixture = await createFixture();
    const response = await verify(makeApp(fixture), fixture, {
      codiceTessera: fixture.milanCardCode,
    });
    expect(response.body).toMatchObject({
      motivoEsito: "AREA_NON_COMPATIBILE",
      beneficiarioId: null,
      beneficiarioNome: null,
      eccezionePossibile: false,
    });
    expect(response.body.allergie).toBeNull();
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
    const [beneficiary] = await db
      .insert(beneficiariTable)
      .values({
        codice: `BEN-ST-${rnd()}`,
        nome: "Storico",
        cognome: "Mensa",
        cittaId: fixture.romeId,
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
    expect(created.cittaId).toBe(fixture.romeId);
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
        cittaId: fixture.romeId,
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

  it("protegge accessi temporanei con permesso dedicato e scope città", async () => {
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

    const crossCity = await request(makeApp(fixture))
      .post("/mensa/accessi/temporaneo")
      .send({
        mensaId: fixture.mensaA,
        beneficiarioId: fixture.milanBeneficiaryId,
        motivo: "Tentativo fuori scope",
        idempotencyKey: `cross-city-${rnd()}`,
      });
    expect(crossCity.status).toBe(404);
    expect(crossCity.body.error).toBe("Beneficiario non disponibile");
  });

  it("emette dal Sociale solo tessere opache e soltanto dopo il completamento dell'anagrafica", async () => {
    const fixture = await createFixture();
    const permissions = [
      ...MENSA_PERMISSIONS.map((item) => item.key),
      "beneficiari.cards.manage",
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

    const completed = await request(app)
      .patch(`/beneficiari/${fixture.beneficiaryId}`)
      .send({ statoAnagrafica: "completa" });
    expect(completed.status).toBe(200);
    expect(completed.body.statoAnagrafica).toBe("completa");
    const issued = await request(app)
      .post(`/beneficiari/${fixture.beneficiaryId}/tessere`)
      .send({ motivoSostituzione: "Sostituzione tessera legacy" });
    expect(issued.status).toBe(201);
    expect(issued.body.codice).toMatch(/^MS-[A-Za-z0-9_-]+$/);
    expect(issued.body.codice).not.toContain("BEN-");
    expect(issued.body.codice).not.toContain("Mario");
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
    const denied = await verify(app, fixture, { mensaId: fixture.mensaB });
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
  });
});
