/* @vitest-environment node */

import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  auditEventiTable,
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prodottiTable,
  systemLogsTable,
  utentiTable,
  areeOperativeTable,
  lottiLogiciTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import carichiRouter from "../src/routes/carichi";
import lottiRouter from "../src/routes/lotti";
import movimentiRouter from "../src/routes/movimenti";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";

let app: Express;
let operatoreId: number;
let magazzinoId: number;
let altroMagazzinoId: number;
let prodottoLiberoId: number;
let prodottoLottoId: number;
let prodottoPezziId: number;
let originalLottiAttivo = true;
let areaOperativaId: number;
let lottoGeneraleId: number;
const suffix = `${process.pid}${Date.now().toString(36)}`;

function makeApp(
  userId: number,
  actorCode: string | null = "M1C-CARICHI-AUDIT",
): Express {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.user = {
      id: userId,
      username: `carichi_2_0a_${suffix}`,
      matricola: actorCode,
      isAdmin: false,
      isSuperAdmin: false,
      aree: ["magazzino"],
      permessi: ["magazzino.view", "magazzino.stock.receive"],
      centroAscoltoId: null,
      areaOperativaId: null,
      zonaUdsId: null,
    };
    next();
  });
  instance.use(carichiRouter);
  instance.use(lottiRouter);
  instance.use(movimentiRouter);
  return instance;
}

async function postCarico(body: Record<string, unknown>) {
  return request(app)
    .post("/carichi")
    .send({
      magazzinoId,
      origineCarico: "RACCOLTA_ALIMENTARE",
      dataCarico: "2026-08-29",
      descrizione: "Raccolta test 2.0A",
      ...body,
    });
}

beforeAll(async () => {
  const required = await pool.query(`
    SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema = 'public' AND (table_name, column_name) IN (
      ('lotti', 'fondo_origine'),
      ('movimenti', 'natura_contabile'),
      ('carichi_magazzino', 'id'),
      ('carichi_magazzino', 'request_hash'),
      ('movimenti', 'fattore_kg_lt_pezzo')
    )
  `);
  if (required.rows[0].count !== 5) {
    throw new Error(
      "Applicare lib/db/updates/20260822_magazzino_2_0a.sql al database di test",
    );
  }

  await ensureAmbienteModuli();
  originalLottiAttivo =
    (await listModuliFunzionali()).find((item) => item.codice === "LOTTI")
      ?.attivo ?? true;
  await updateModuloAmbiente("LOTTI", true, null);

  [{ id: operatoreId }] = await db
    .insert(utentiTable)
    .values({
      username: `carichi_2_0a_${suffix}`,
      passwordHash: "x",
      nome: "Test",
      cognome: "Carichi",
    })
    .returning({ id: utentiTable.id });
  [{ id: areaOperativaId }] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area carichi ${suffix}` })
    .returning({ id: areeOperativeTable.id });
  [{ id: lottoGeneraleId }] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId,
      codice: "GENERALE",
      descrizione: "Generale",
      isGenerale: true,
    })
    .returning({ id: lottiLogiciTable.id });
  [{ id: magazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `C20A-${suffix}`.slice(0, 20),
      nome: `Magazzino carichi ${suffix}`,
      areaOperativaId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: altroMagazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `C20B-${suffix}`.slice(0, 20),
      nome: `Altro magazzino carichi ${suffix}`,
      areaOperativaId,
    })
    .returning({ id: magazziniTable.id });
  [{ id: prodottoLiberoId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `C20AL-${suffix}`.slice(0, 30),
      nome: "Prodotto senza lotto 2.0A",
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      quantitaFrazionabile: true,
      lottoFisicoObbligatorio: false,
      gestioneScadenza: false,
    })
    .returning({ id: prodottiTable.id });
  [{ id: prodottoLottoId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `C20AP-${suffix}`.slice(0, 30),
      nome: "Prodotto con lotto 2.0A",
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      quantitaFrazionabile: true,
      lottoFisicoObbligatorio: true,
      gestioneScadenza: true,
    })
    .returning({ id: prodottiTable.id });
  [{ id: prodottoPezziId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `C20AZ-${suffix}`.slice(0, 30),
      nome: "Prodotto pezzi 2.0A-R1",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      lottoFisicoObbligatorio: true,
      gestioneScadenza: true,
    })
    .returning({ id: prodottiTable.id });
  app = makeApp(operatoreId);
});

afterAll(async () => {
  await db
    .delete(movimentiTable)
    .where(eq(movimentiTable.magazzinoId, magazzinoId));
  await db
    .delete(movimentiTable)
    .where(eq(movimentiTable.magazzinoId, altroMagazzinoId));
  await db
    .delete(carichiMagazzinoRigheTable)
    .where(eq(carichiMagazzinoRigheTable.prodottoId, prodottoLiberoId));
  await db
    .delete(carichiMagazzinoRigheTable)
    .where(eq(carichiMagazzinoRigheTable.prodottoId, prodottoLottoId));
  await db
    .delete(carichiMagazzinoRigheTable)
    .where(eq(carichiMagazzinoRigheTable.prodottoId, prodottoPezziId));
  await db
    .delete(carichiMagazzinoTable)
    .where(eq(carichiMagazzinoTable.magazzinoId, magazzinoId));
  await db
    .delete(carichiMagazzinoTable)
    .where(eq(carichiMagazzinoTable.magazzinoId, altroMagazzinoId));
  await db.delete(lottiTable).where(eq(lottiTable.magazzinoId, magazzinoId));
  await db
    .delete(lottiTable)
    .where(eq(lottiTable.magazzinoId, altroMagazzinoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoLiberoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoLottoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoPezziId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, magazzinoId));
  await db
    .delete(magazziniTable)
    .where(eq(magazziniTable.id, altroMagazzinoId));
  await db
    .delete(lottiLogiciTable)
    .where(eq(lottiLogiciTable.id, lottoGeneraleId));
  await db
    .delete(areeOperativeTable)
    .where(eq(areeOperativeTable.id, areaOperativaId));
  await db
    .delete(systemLogsTable)
    .where(eq(systemLogsTable.actorUserId, operatoreId));
  await db.delete(utentiTable).where(eq(utentiTable.id, operatoreId));
  await updateModuloAmbiente("LOTTI", originalLottiAttivo, null);
  await pool.end();
});

describe("POST /carichi — Magazzino 2.0A", () => {
  it("ammette una raccolta senza fornitore e contabilizza più righe in un commit", async () => {
    const response = await postCarico({
      idempotencyKey: `raccolta-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLiberoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.334957",
          unitaMisuraOperativa: "kg",
        },
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "FSE_PLUS",
          quantitaOperativa: "53.59312",
          unitaMisuraOperativa: "kg",
          codiceLotto: " xyz   01 ",
          dataScadenza: "2027-01-31",
        },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.righe).toHaveLength(2);
    expect(
      response.body.righe.map(
        (riga: { quantitaOperativa: string }) => riga.quantitaOperativa,
      ),
    ).toEqual(["0.334957", "53.593120"]);
    expect(response.body.righe[1]).toMatchObject({
      fondoOrigine: "FSE_PLUS",
      codiceLottoNormalizzato: "XYZ 01",
    });

    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.entitaOrigineId, response.body.id));
    expect(movements).toHaveLength(2);
    expect(
      movements.every(
        (movement) =>
          movement.naturaContabile === "CARICO" &&
          movement.caricoMagazzinoRigaId != null &&
          movement.operatoreId === operatoreId,
      ),
    ).toBe(true);
    expect(
      movements.reduce(
        (total, movement) => total + Number(movement.quantita),
        0,
      ),
    ).toBeCloseTo(53.928077, 6);
    const auditEvents = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "carico_magazzino"),
          eq(auditEventiTable.entitaId, response.body.id),
        ),
      );
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].actorUserId).toBe(operatoreId);
    expect(
      movements.every(
        (movement) => movement.auditEventoId === auditEvents[0].id,
      ),
    ).toBe(true);
  });

  it("la idempotency key ripetuta non duplica testata, righe, Partite o movimenti", async () => {
    const key = `idem-${suffix}`;
    const body = {
      idempotencyKey: key,
      righe: [
        {
          prodottoId: prodottoLiberoId,
          fondoOrigine: "FONDO_NAZIONALE",
          quantitaOperativa: "1.000001",
          unitaMisuraOperativa: "kg",
        },
      ],
    };
    const first = await postCarico(body);
    const replay = await postCarico(body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ id: first.body.id, replay: true });
    expect(
      await db
        .select()
        .from(carichiMagazzinoTable)
        .where(eq(carichiMagazzinoTable.idempotencyKey, key)),
    ).toHaveLength(1);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.entitaOrigineId, first.body.id));
    expect(movements).toHaveLength(1);
    const auditEvents = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.operationKey, key));
    expect(auditEvents).toHaveLength(1);
    expect(movements[0].auditEventoId).toBe(auditEvents[0].id);
    expect(replay.body.requestHash).toBeUndefined();
  });

  it("deriva l'attore dalla sessione, ignora spoof payload e conserva lo snapshot", async () => {
    const originalCode = `M1C-A-${suffix}`.slice(0, 20);
    const changedCode = `M1C-Z-${suffix}`.slice(0, 20);
    await db
      .update(utentiTable)
      .set({ matricola: originalCode, attivo: true })
      .where(eq(utentiTable.id, operatoreId));
    const actorApp = makeApp(operatoreId, originalCode);
    const response = await request(actorApp)
      .post("/carichi")
      .send({
        magazzinoId,
        origineCarico: "RACCOLTA_ALIMENTARE",
        dataCarico: "2026-08-29",
        idempotencyKey: `actor-${suffix}`,
        operatoreId: 2_000_000_000,
        actorUserId: 2_000_000_000,
        creatoDa: 2_000_000_000,
        righe: [
          {
            prodottoId: prodottoLiberoId,
            fondoOrigine: "NESSUN_FONDO",
            quantitaOperativa: "1",
          },
        ],
      });
    expect(response.status).toBe(201);

    const [movement] = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.entitaOrigineId, response.body.id));
    const [audit] = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.id, movement.auditEventoId!));
    expect(audit).toMatchObject({
      actorType: "user",
      actorUserId: operatoreId,
      actorCodeSnapshot: originalCode,
    });
    expect(movement.operatoreId).toBe(operatoreId);

    await db
      .update(utentiTable)
      .set({ matricola: changedCode, attivo: false })
      .where(eq(utentiTable.id, operatoreId));
    const [persisted] = await db
      .select()
      .from(auditEventiTable)
      .where(eq(auditEventiTable.id, audit.id));
    expect(persisted.actorCodeSnapshot).toBe(originalCode);
    const listed = await request(actorApp)
      .get("/movimenti")
      .query({ magazzinoId });
    expect(listed.status).toBe(200);
    expect(
      listed.body.find((item: { id: number }) => item.id === movement.id)
        .operatoreCodice,
    ).toBe(originalCode);
    await db
      .update(utentiTable)
      .set({ matricola: null, attivo: true })
      .where(eq(utentiTable.id, operatoreId));
  });

  it("usa lo username come snapshot quando la matricola è assente", async () => {
    const username = `carichi_2_0a_${suffix}`;
    const usernameApp = makeApp(operatoreId, null);
    const response = await request(usernameApp)
      .post("/carichi")
      .send({
        magazzinoId,
        origineCarico: "RACCOLTA_ALIMENTARE",
        dataCarico: "2026-08-29",
        idempotencyKey: `username-fallback-${suffix}`,
        righe: [
          {
            prodottoId: prodottoLiberoId,
            fondoOrigine: "NESSUN_FONDO",
            quantitaOperativa: "1",
          },
        ],
      });
    expect(response.status).toBe(201);

    const [audit] = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "carico_magazzino"),
          eq(auditEventiTable.entitaId, response.body.id),
        ),
      );
    expect(audit.actorCodeSnapshot).toBe(username);
  });

  it("annulla carico, lotti e movimenti quando l'inserimento audit fallisce", async () => {
    const before = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM carichi_magazzino WHERE magazzino_id = $1) AS carichi,
         (SELECT count(*)::int FROM lotti WHERE magazzino_id = $1) AS lotti,
         (SELECT count(*)::int FROM movimenti WHERE magazzino_id = $1) AS movimenti`,
      [magazzinoId],
    );
    const badAuditApp = makeApp(operatoreId, "X".repeat(161));
    const response = await request(badAuditApp)
      .post("/carichi")
      .send({
        magazzinoId,
        origineCarico: "RACCOLTA_ALIMENTARE",
        dataCarico: "2026-08-29",
        idempotencyKey: `audit-failure-${suffix}`,
        righe: [
          {
            prodottoId: prodottoLiberoId,
            fondoOrigine: "NESSUN_FONDO",
            quantitaOperativa: "1",
          },
        ],
      });
    expect(response.status).toBe(500);
    const after = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM carichi_magazzino WHERE magazzino_id = $1) AS carichi,
         (SELECT count(*)::int FROM lotti WHERE magazzino_id = $1) AS lotti,
         (SELECT count(*)::int FROM movimenti WHERE magazzino_id = $1) AS movimenti`,
      [magazzinoId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("lega la idempotency key al contenuto normalizzato", async () => {
    const key = `idem-content-${suffix}`;
    const base = {
      idempotencyKey: key,
      righe: [
        {
          prodottoId: prodottoLiberoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "2.000000",
        },
      ],
    };
    const first = await postCarico(base);
    expect(first.status).toBe(201);
    for (const changed of [
      { ...base, righe: [{ ...base.righe[0], quantitaOperativa: "3" }] },
      {
        ...base,
        righe: [
          {
            ...base.righe[0],
            prodottoId: prodottoLottoId,
            codiceLotto: "IDEM-PROD-R1",
            dataScadenza: "2027-12-01",
          },
        ],
      },
      {
        ...base,
        righe: [{ ...base.righe[0], fondoOrigine: "FONDO_NAZIONALE" }],
      },
    ]) {
      const conflict = await postCarico(changed);
      expect(conflict.status).toBe(409);
    }
    expect(
      await db
        .select()
        .from(auditEventiTable)
        .where(eq(auditEventiTable.operationKey, key)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.entitaOrigineId, first.body.id)),
    ).toHaveLength(1);
  });

  it("non espone un carico precedente se la stessa key viene usata in un altro Magazzino", async () => {
    const key = `idem-scope-${suffix}`;
    const body = {
      idempotencyKey: key,
      righe: [
        {
          prodottoId: prodottoLiberoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
        },
      ],
    };
    const first = await postCarico(body);
    const conflict = await request(app)
      .post("/carichi")
      .send({
        magazzinoId: altroMagazzinoId,
        origineCarico: "RACCOLTA_ALIMENTARE",
        dataCarico: "2026-08-29",
        ...body,
      });
    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(conflict.body.id).toBeUndefined();
  });

  it("serializza replay concorrenti in una sola contabilizzazione", async () => {
    const key = `idem-race-${suffix}`;
    const body = {
      idempotencyKey: key,
      righe: [
        {
          prodottoId: prodottoLiberoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.000001",
        },
      ],
    };
    const responses = await Promise.all([
      postCarico(body),
      postCarico(body),
      postCarico(body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200, 201,
    ]);
    const ids = new Set(responses.map((response) => response.body.id));
    expect(ids.size).toBe(1);
  });

  it.each(["AGEA_SIFEAD", "RETTIFICA_INVENTARIO", "SALDO_INIZIALE", "LEGACY"])(
    "rifiuta l'origine riservata %s dal flusso manuale",
    async (origine) => {
      const response = await postCarico({
        origineCarico: origine,
        righe: [
          {
            prodottoId: prodottoLiberoId,
            fondoOrigine: "NESSUN_FONDO",
            quantitaOperativa: "1",
          },
        ],
      });
      expect(response.status).toBe(403);
    },
  );

  it("contabilizza Pezzi, Kg/Lt e fattore coerenti e ne salva lo snapshot", async () => {
    const response = await postCarico({
      idempotencyKey: `dimensions-${suffix}`,
      righe: [
        {
          prodottoId: prodottoPezziId,
          fondoOrigine: "FSE_PLUS",
          quantitaOperativa: "160",
          quantitaKgLt: "53.593120",
          fattoreKgLtPezzo: "0.334957000",
          codiceLotto: "DIM-R1",
          dataScadenza: "2027-05-01",
        },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.righe[0]).toMatchObject({
      quantitaPezzi: "160.000000",
      quantitaKgLt: "53.593120",
      fattoreKgLtPezzo: "0.334957000",
    });
    const [movement] = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.entitaOrigineId, response.body.id));
    expect(movement).toMatchObject({
      quantitaPezzi: "160.00",
      quantitaKgLt: "53.59312",
      fattoreKgLtPezzo: "0.334957",
    });
  });

  it("non adotta lotti legacy ambigui e crea una nuova Partita nel Generale", async () => {
    await db.insert(lottiTable).values([
      {
        prodottoId: prodottoLottoId,
        codiceLotto: "LEGACY R1",
        codiceLottoNormalizzato: null,
        dataScadenza: "2027-06-01",
        dataCarico: "2026-01-01",
        quantitaCaricata: "2",
        quantitaResidua: "2",
        magazzinoId,
        fondoOrigine: "NESSUN_FONDO",
      },
      {
        prodottoId: prodottoLottoId,
        codiceLotto: " legacy   r1 ",
        codiceLottoNormalizzato: null,
        dataScadenza: "2027-06-01",
        dataCarico: "2026-01-02",
        quantitaCaricata: "3",
        quantitaResidua: "3",
        magazzinoId,
        fondoOrigine: "NESSUN_FONDO",
      },
    ]);
    const response = await postCarico({
      idempotencyKey: `legacy-ambiguous-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
          codiceLotto: "legacy r1",
          dataScadenza: "2027-06-01",
        },
      ],
    });
    expect(response.status).toBe(201);
    const candidates = await db
      .select()
      .from(lottiTable)
      .where(
        and(
          eq(lottiTable.magazzinoId, magazzinoId),
          eq(lottiTable.prodottoId, prodottoLottoId),
        ),
      );
    expect(
      candidates.filter(
        (lotto) => lotto.codiceLottoNormalizzato === "LEGACY R1",
      ),
    ).toEqual([
      expect.objectContaining({
        id: response.body.righe[0].lottoId,
        lottoLogicoId: lottoGeneraleId,
      }),
    ]);
    expect(
      candidates.filter((lotto) => lotto.lottoLogicoId == null),
    ).toHaveLength(2);
  });

  it("non adotta una Partita legacy compatibile e la lascia senza lotto logico", async () => {
    const [legacy] = await db
      .insert(lottiTable)
      .values({
        prodottoId: prodottoLottoId,
        codiceLotto: "  legacy unica r1  ",
        codiceLottoNormalizzato: null,
        dataScadenza: "2027-07-01",
        dataCarico: "2026-01-03",
        quantitaCaricata: "1",
        quantitaResidua: "1",
        magazzinoId,
        fondoOrigine: "NESSUN_FONDO",
      })
      .returning();
    const response = await postCarico({
      idempotencyKey: `legacy-single-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "0.000001",
          codiceLotto: "LEGACY UNICA R1",
          dataScadenza: "2027-07-01",
        },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.righe[0].lottoId).not.toBe(legacy.id);
    const [unchanged] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, legacy.id));
    expect(unchanged.codiceLottoNormalizzato).toBeNull();
    expect(Number(unchanged.quantitaResidua)).toBe(1);
    const [created] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, response.body.righe[0].lottoId));
    expect(created).toMatchObject({
      lottoLogicoId: lottoGeneraleId,
      codiceLottoNormalizzato: "LEGACY UNICA R1",
    });
    expect(Number(created.quantitaResidua)).toBe(0.000001);
  });

  it("mantiene distinte le Partite con fattori diversi", async () => {
    const first = await postCarico({
      idempotencyKey: `factor-a-${suffix}`,
      righe: [
        {
          prodottoId: prodottoPezziId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "10",
          fattoreKgLtPezzo: "0.500000000",
          codiceLotto: "FACTOR-R1",
          dataScadenza: "2027-08-01",
        },
      ],
    });
    const conflict = await postCarico({
      idempotencyKey: `factor-b-${suffix}`,
      righe: [
        {
          prodottoId: prodottoPezziId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
          fattoreKgLtPezzo: "0.600000000",
          codiceLotto: "FACTOR-R1",
          dataScadenza: "2027-08-01",
        },
      ],
    });
    expect(first.status).toBe(201);
    expect(conflict.status).toBe(201);
    expect(conflict.body.righe[0].lottoId).not.toBe(
      first.body.righe[0].lottoId,
    );
  });

  it("mantiene stabile il replay se lo stesso codice riceve una Partita con fattore distinto", async () => {
    const key = `factor-late-replay-${suffix}`;
    const line = {
      prodottoId: prodottoPezziId,
      fondoOrigine: "NESSUN_FONDO",
      quantitaOperativa: "2",
      codiceLotto: "FACTOR-LATE-R1",
      dataScadenza: "2027-10-01",
    };
    const first = await postCarico({ idempotencyKey: key, righe: [line] });
    const factorLoad = await postCarico({
      idempotencyKey: `factor-late-set-${suffix}`,
      righe: [{ ...line, fattoreKgLtPezzo: "0.500000000" }],
    });
    const replay = await postCarico({ idempotencyKey: key, righe: [line] });
    expect(first.status).toBe(201);
    expect(factorLoad.status).toBe(201);
    expect(factorLoad.body.righe[0].lottoId).not.toBe(
      first.body.righe[0].lottoId,
    );
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.replay).toBe(true);
  });

  it("due carichi compatibili incrementano la stessa Partita senza perdita di precisione", async () => {
    const first = await postCarico({
      idempotencyKey: `partita-a-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "FSE_PLUS",
          quantitaOperativa: "10.000000",
          codiceLotto: "PRECISIONE-01",
          dataScadenza: "2027-02-01",
        },
      ],
    });
    const second = await postCarico({
      idempotencyKey: `partita-b-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "FSE_PLUS",
          quantitaOperativa: "26.79656",
          codiceLotto: " precisione-01 ",
          dataScadenza: "2027-02-01",
        },
      ],
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.righe[0].lottoId).toBe(first.body.righe[0].lottoId);
    expect(second.body.righe[0].partitaQuantitaCaricata).toBe("36.796560");
    const parties = await db
      .select()
      .from(lottiTable)
      .where(
        and(
          eq(lottiTable.magazzinoId, magazzinoId),
          eq(lottiTable.codiceLottoNormalizzato, "PRECISIONE-01"),
        ),
      );
    expect(parties).toHaveLength(1);
  });

  it("un errore sull'ultima riga produce rollback totale e nessun audit parziale", async () => {
    const key = `rollback-${suffix}`;
    const before = await pool.query(
      `
      SELECT
        (SELECT count(*)::int FROM carichi_magazzino WHERE magazzino_id = $1) AS carichi,
        (SELECT count(*)::int FROM carichi_magazzino_righe r JOIN carichi_magazzino c ON c.id = r.carico_magazzino_id WHERE c.magazzino_id = $1) AS righe,
        (SELECT count(*)::int FROM lotti WHERE magazzino_id = $1) AS lotti,
        (SELECT count(*)::int FROM movimenti WHERE magazzino_id = $1) AS movimenti,
        (SELECT count(*)::int FROM system_logs WHERE actor_user_id = $2 AND evento = 'MAGAZZINO_CARICO_CONFERMATO') AS audit
    `,
      [magazzinoId, operatoreId],
    );
    const response = await postCarico({
      idempotencyKey: key,
      righe: [
        {
          prodottoId: prodottoLiberoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
        },
        {
          prodottoId: prodottoLiberoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "2",
        },
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "3",
          dataScadenza: "2027-03-01",
        },
      ],
    });
    expect(response.status).toBe(400);
    const after = await pool.query(
      `
      SELECT
        (SELECT count(*)::int FROM carichi_magazzino WHERE magazzino_id = $1) AS carichi,
        (SELECT count(*)::int FROM carichi_magazzino_righe r JOIN carichi_magazzino c ON c.id = r.carico_magazzino_id WHERE c.magazzino_id = $1) AS righe,
        (SELECT count(*)::int FROM lotti WHERE magazzino_id = $1) AS lotti,
        (SELECT count(*)::int FROM movimenti WHERE magazzino_id = $1) AS movimenti,
        (SELECT count(*)::int FROM system_logs WHERE actor_user_id = $2 AND evento = 'MAGAZZINO_CARICO_CONFERMATO') AS audit
    `,
      [magazzinoId, operatoreId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("stesso lotto con Fondo diverso crea Partite distinte", async () => {
    const national = await postCarico({
      idempotencyKey: `fondo-n-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "FONDO_NAZIONALE",
          quantitaOperativa: "2",
          codiceLotto: "FONDO-01",
          dataScadenza: "2027-04-01",
        },
      ],
    });
    const cofunded = await postCarico({
      idempotencyKey: `fondo-c-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "FONDO_NAZIONALE_COFINANZIATO",
          quantitaOperativa: "2",
          codiceLotto: "FONDO-01",
          dataScadenza: "2027-04-01",
        },
      ],
    });
    expect(national.status).toBe(201);
    expect(cofunded.status).toBe(201);
    expect(cofunded.body.righe[0].lottoId).not.toBe(
      national.body.righe[0].lottoId,
    );
    expect([
      national.body.righe[0].fondoOrigine,
      cofunded.body.righe[0].fondoOrigine,
    ]).toEqual(["FONDO_NAZIONALE", "FONDO_NAZIONALE_COFINANZIATO"]);
  });

  it("filtra per origine di Carico presente senza duplicare la Partita", async () => {
    const first = await postCarico({
      idempotencyKey: `origin-a-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "1",
          codiceLotto: "ORIGIN-FILTER-R1",
          dataScadenza: "2027-09-01",
        },
      ],
    });
    const second = await postCarico({
      origineCarico: "DONAZIONE",
      idempotencyKey: `origin-b-${suffix}`,
      righe: [
        {
          prodottoId: prodottoLottoId,
          fondoOrigine: "NESSUN_FONDO",
          quantitaOperativa: "2",
          codiceLotto: "ORIGIN-FILTER-R1",
          dataScadenza: "2027-09-01",
        },
      ],
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.righe[0].lottoId).toBe(first.body.righe[0].lottoId);

    const filtered = await request(app).get("/lotti").query({
      magazzinoId,
      origineCaricoPresente: "RACCOLTA_ALIMENTARE",
    });
    expect(filtered.status).toBe(200);
    expect(
      filtered.body.filter(
        (lotto: { id: number }) => lotto.id === first.body.righe[0].lottoId,
      ),
    ).toHaveLength(1);
  });
});
