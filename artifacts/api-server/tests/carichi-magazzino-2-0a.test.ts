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
import lottiRouter from "../src/routes/lotti";
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
  instance.use(lottiRouter);
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
  [{ id: magazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `C20A-${suffix}`.slice(0, 20),
      nome: `Magazzino carichi ${suffix}`,
    })
    .returning({ id: magazziniTable.id });
  [{ id: altroMagazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `C20B-${suffix}`.slice(0, 20),
      nome: `Altro magazzino carichi ${suffix}`,
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
  [{ id: prodottoPezziId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `C20AZ-${suffix}`.slice(0, 30),
      nome: "Prodotto pezzi 2.0A-R1",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
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
    expect(replay.body.requestHash).toBeUndefined();
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
    const conflict = await request(app).post("/carichi").send({
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

  it.each([
    "AGEA_SIFEAD",
    "RETTIFICA_INVENTARIO",
    "SALDO_INIZIALE",
    "LEGACY",
  ])("rifiuta l'origine riservata %s dal flusso manuale", async (origine) => {
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
  });

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

  it("blocca senza creare una terza Partita quando i lotti legacy sono ambigui", async () => {
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
    expect(response.status).toBe(409);
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
      candidates.filter((lotto) => lotto.codiceLottoNormalizzato === "LEGACY R1"),
    ).toHaveLength(0);
  });

  it("adotta in modo deterministico una sola Partita legacy compatibile", async () => {
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
    expect(response.body.righe[0].lottoId).toBe(legacy.id);
    const [adopted] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, legacy.id));
    expect(adopted.codiceLottoNormalizzato).toBe("LEGACY UNICA R1");
    expect(adopted.quantitaResidua).toBe("1.000001");
  });

  it("rifiuta un fattore diverso da quello già fissato sulla Partita", async () => {
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
    expect(conflict.status).toBe(409);
  });

  it("mantiene stabile il replay se la Partita acquisisce un fattore dopo il primo Carico", async () => {
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

    const filtered = await request(app)
      .get("/lotti")
      .query({
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
