/* @vitest-environment node */

import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
  prodottiTable,
  systemLogsTable,
  utentiTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import carichiRouter from "../src/routes/carichi";
import {
  ensureAmbienteModuli,
  listModuliFunzionali,
  updateModuloAmbiente,
} from "../src/lib/configurazioneAmbiente";

let app: Express;
let operatoreId: number;
let magazzinoId: number;
let prodottoLiberoId: number;
let prodottoLottoId: number;
let originalLottiAttivo = true;
const suffix = `${process.pid}${Date.now().toString(36)}`;

function makeApp(userId: number): Express {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.user = {
      id: userId,
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
      ('carichi_magazzino', 'id')
    )
  `);
  if (required.rows[0].count !== 3) {
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
  [{ id: magazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `C20A-${suffix}`.slice(0, 20),
      nome: `Magazzino carichi ${suffix}`,
    })
    .returning({ id: magazziniTable.id });
  [{ id: prodottoLiberoId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `C20AL-${suffix}`.slice(0, 30),
      nome: "Prodotto senza lotto 2.0A",
      tipoProdotto: "alimentare",
      unitaMisura: "kg",
      gestioneLotto: false,
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
      gestioneLotto: true,
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
    .delete(carichiMagazzinoRigheTable)
    .where(eq(carichiMagazzinoRigheTable.prodottoId, prodottoLiberoId));
  await db
    .delete(carichiMagazzinoRigheTable)
    .where(eq(carichiMagazzinoRigheTable.prodottoId, prodottoLottoId));
  await db
    .delete(carichiMagazzinoTable)
    .where(eq(carichiMagazzinoTable.magazzinoId, magazzinoId));
  await db.delete(lottiTable).where(eq(lottiTable.magazzinoId, magazzinoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoLiberoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoLottoId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, magazzinoId));
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
    ).toEqual(["0.334957", "53.59312"]);
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
          movement.caricoMagazzinoRigaId != null,
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
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.entitaOrigineId, first.body.id)),
    ).toHaveLength(1);
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
    expect(second.body.righe[0].partitaQuantitaCaricata).toBe("36.79656");
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
});
