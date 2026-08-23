/* @vitest-environment node */

import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseIndicatoriTable,
  esportazioniFseRigheTable,
  esportazioniFseSaldiTable,
  esportazioniFseTable,
  lottiTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  rilevazioniMonitoraggioFseTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fseRouter from "../src/routes/fse";
import {
  cleanup,
  createAreaOperativa,
  createCentroRec,
  createMagazzino,
  createLotto,
  createProdotto,
  createUtente,
  insertMovimento,
  makeScopedApp,
  newScope,
} from "./scope-helpers";

const scope = newScope();
const exportIds: number[] = [];
let areaA: number;
let areaB: number;
let centroA: number;
let centroSameArea: number;
let centroB: number;
let magazzinoA: number;
let magazzinoSameArea: number;
let magazzinoB: number;
let userId: number;

const app = (
  centroAscoltoId: number | null,
  permessi: string[],
  areaOperativaId = areaA,
) =>
  makeScopedApp(fseRouter, {
    id: userId,
    centroAscoltoId,
    areaOperativaId,
    permessi,
  });

beforeAll(async () => {
  areaA = await createAreaOperativa(scope);
  areaB = await createAreaOperativa(scope);
  centroA = (await createCentroRec(scope, { areaOperativaId: areaA })).id;
  centroSameArea = (await createCentroRec(scope, { areaOperativaId: areaA }))
    .id;
  centroB = (await createCentroRec(scope, { areaOperativaId: areaB })).id;
  magazzinoA = await createMagazzino(scope, centroA, {
    areaOperativaId: areaA,
  });
  magazzinoSameArea = await createMagazzino(scope, centroSameArea, {
    areaOperativaId: areaA,
  });
  magazzinoB = await createMagazzino(scope, centroB, {
    areaOperativaId: areaB,
  });
  userId = await createUtente(scope, { centroId: centroA });
});

afterAll(async () => {
  if (exportIds.length > 0) {
    await db
      .delete(esportazioniFseIndicatoriTable)
      .where(inArray(esportazioniFseIndicatoriTable.esportazioneId, exportIds));
    await db
      .delete(esportazioniFseSaldiTable)
      .where(inArray(esportazioniFseSaldiTable.esportazioneId, exportIds));
    const events = await db
      .select({ id: esportazioniFseEventiTable.id })
      .from(esportazioniFseEventiTable)
      .where(inArray(esportazioniFseEventiTable.esportazioneId, exportIds));
    if (events.length > 0) {
      await db.delete(esportazioniFseRigheTable).where(
        inArray(
          esportazioniFseRigheTable.esportazioneEventoId,
          events.map((row) => row.id),
        ),
      );
    }
    await db
      .delete(esportazioniFseEventiTable)
      .where(inArray(esportazioniFseEventiTable.esportazioneId, exportIds));
    await db
      .delete(esportazioniFseTable)
      .where(inArray(esportazioniFseTable.id, exportIds));
  }
  const warehouseIds = [magazzinoA, magazzinoSameArea, magazzinoB].filter(
    (id): id is number => Number.isInteger(id),
  );
  if (warehouseIds.length > 0) {
    await db
      .delete(rilevazioniMonitoraggioFseTable)
      .where(
        inArray(rilevazioniMonitoraggioFseTable.magazzinoId, warehouseIds),
      );
  }
  await cleanup(scope);
  await pool.end();
});

describe("Magazzino 2.0C — API FSE+", () => {
  it("separa view ed export nell'RBAC", async () => {
    const viewOnly = app(centroA, ["magazzino.fse.view"]);
    const preview = await request(viewOnly)
      .get("/fse/rendicontazione/preview")
      .query({
        magazzinoId: magazzinoA,
        dataDa: "2026-08-01",
        dataA: "2026-08-31",
        dataAsOf: "2026-08-31",
      });
    expect(preview.status).toBe(200);

    for (const projection of ["eventi", "righe", "qualita"]) {
      const page = await request(viewOnly)
        .get(`/fse/rendicontazione/${projection}`)
        .query({
          magazzinoId: magazzinoA,
          dataCompetenzaDa: "2026-08-01",
          dataCompetenzaA: "2026-08-31",
          includeArretrati: true,
          page: 1,
          pageSize: 10,
        });
      expect(page.status, page.text).toBe(200);
      expect(page.body).toMatchObject({
        page: 1,
        pageSize: 10,
        total: 0,
        rows: [],
      });
      expect(page.body.summary.cutoff).toBeDefined();
    }

    const forbidden = await request(viewOnly).post("/fse/exportazioni").send({
      magazzinoId: magazzinoA,
      dataDa: "2026-08-01",
      dataA: "2026-08-31",
      dataAsOf: "2026-08-31",
      formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
    });
    expect(forbidden.status).toBe(403);

    expect(
      (await request(viewOnly).post("/fse/riconciliazioni").send({})).status,
    ).toBe(403);
    expect(
      (
        await request(app(centroA, ["magazzino.fse.reconcile"]))
          .post("/fse/riconciliazioni/999999/chiudi")
          .send({ versione: 1, conScostamenti: true, motivazione: "test" })
      ).status,
    ).toBe(403);
  });

  it("non crea un export amministrativo vuoto", async () => {
    const response = await request(
      app(centroB, ["magazzino.fse.view", "magazzino.fse.export"], areaB),
    )
      .post("/fse/exportazioni")
      .send({
        magazzinoId: magazzinoB,
        dataDa: "2026-08-01",
        dataA: "2026-08-31",
        dataAsOf: "2026-08-31",
        formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("NESSUN_DATO_DA_RENDICONTARE");
  });

  it("impedisce IDOR di dettaglio e download tra Centri della stessa Area Operativa", async () => {
    const productId = await createProdotto(scope);
    await insertMovimento(scope, {
      magazzinoId: magazzinoSameArea,
      prodottoId: productId,
      tipoMovimento: "scarico",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      fondoOrigine: "FSE_PLUS",
    });
    const permissions = ["magazzino.fse.view", "magazzino.fse.export"];
    const created = await request(app(centroSameArea, permissions))
      .post("/fse/exportazioni")
      .send({
        magazzinoId: magazzinoSameArea,
        dataDa: "2026-07-01",
        dataA: "2026-07-31",
        dataAsOf: "2026-07-31",
        formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
      });
    expect(created.status).toBe(201);
    exportIds.push(created.body.id);

    const inaccessible = await request(app(centroA, permissions)).get(
      `/fse/exportazioni/${created.body.id}`,
    );
    expect(inaccessible.status).toBe(403);
    const download = await request(app(centroA, permissions)).get(
      `/fse/exportazioni/${created.body.id}/download`,
    );
    expect(download.status).toBe(403);
  });

  it("impedisce l'accesso a un Magazzino fuori Area Operativa", async () => {
    const permissions = ["magazzino.fse.view"];
    const response = await request(app(null, permissions, areaA))
      .get("/fse/rendicontazione/preview")
      .query({
        magazzinoId: magazzinoB,
        dataDa: "2026-08-01",
        dataA: "2026-08-31",
      });
    expect(response.status).toBe(403);
  });

  it("rifiuta versione assente e impedisce l'inserimento di export con blocker", async () => {
    const productId = await createProdotto(scope);
    await insertMovimento(scope, {
      magazzinoId: magazzinoA,
      prodottoId: productId,
      tipoMovimento: "scarico",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      fondoOrigine: "FSE_PLUS",
    });
    const permissions = ["magazzino.fse.view", "magazzino.fse.export"];
    const client = app(centroA, permissions);
    const created = await request(client).post("/fse/exportazioni").send({
      magazzinoId: magazzinoA,
      dataDa: "2026-06-01",
      dataA: "2026-06-30",
      dataAsOf: "2026-06-30",
      formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
    });
    expect(created.status).toBe(201);
    exportIds.push(created.body.id);

    expect(
      (
        await request(client)
          .post(`/fse/exportazioni/${created.body.id}/marca-inserita`)
          .send({
            data: "2026-08-20",
            riferimentoEsterno: "SIFEAD-TEST",
          })
      ).status,
    ).toBe(400);

    const updated = await request(client)
      .post(`/fse/exportazioni/${created.body.id}/marca-inserita`)
      .send({
        versione: 1,
        data: "2026-08-20",
        riferimentoEsterno: "SIFEAD-TEST",
      });
    expect(updated.status).toBe(409);

    expect(
      (
        await request(client)
          .post(`/fse/exportazioni/${created.body.id}/marca-inserita`)
          .send({
            versione: 1,
            data: "2026-08-20",
            riferimentoEsterno: "SIFEAD-STALE",
          })
      ).status,
    ).toBe(409);
  });

  it("mantiene distinti zero e dato non rilevato nel monitoraggio", async () => {
    const permissions = [
      "magazzino.fse.view",
      "magazzino.fse.monitoring.manage",
    ];
    const client = app(centroA, permissions);
    const created = await request(client).post("/fse/monitoraggio").send({
      magazzinoId: magazzinoA,
      annoMese: "2026-08",
      canaleUfficiale: "PACCHI",
      dataRiferimento: "2026-08-31",
      minori18: 0,
      fonte: "RILEVAZIONE_MANUALE_VERIFICATA",
      completezza: "PARZIALE",
    });
    expect(created.status).toBe(201);
    expect(created.body.minori18).toBe(0);
    expect(created.body.giovani18_29).toBeNull();

    expect(
      (
        await request(client)
          .patch(`/fse/monitoraggio/${created.body.id}`)
          .send({ donne: 5 })
      ).status,
    ).toBe(400);
    const concurrentUpdates = await Promise.all([
      request(client).patch(`/fse/monitoraggio/${created.body.id}`).send({
        versione: 1,
        donne: 5,
        noteAudit: "Rilevazione verificata",
      }),
      request(client).patch(`/fse/monitoraggio/${created.body.id}`).send({
        versione: 1,
        donne: 6,
        noteAudit: "Rilevazione concorrente",
      }),
    ]);
    expect(concurrentUpdates.map((response) => response.status).sort()).toEqual(
      [200, 409],
    );
    const updated = concurrentUpdates.find(
      (response) => response.status === 200,
    )!;
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      versione: 2,
      minori18: 0,
      giovani18_29: null,
      donne: expect.any(Number),
    });
  });

  it("rifiuta monitoraggio cross-Magazzino, canale/mese ed enum non validi", async () => {
    const [foreignOperation] = await db
      .insert(operazioniDistribuzioneMagazzinoTable)
      .values({
        magazzinoId: magazzinoSameArea,
        dataDistribuzione: "2026-09-10",
        canaleOperativo: "MENSA",
        dominioOrigine: "R2_MONITORING",
        entitaOrigineTipo: "TEST",
        entitaOrigineId: Number(String(Date.now()).slice(-8)),
        numeroPasti: 1,
        indigentiSaltuari: 0,
        indigentiContinuativi: 1,
        creatoDa: userId,
      })
      .returning({ id: operazioniDistribuzioneMagazzinoTable.id });
    const client = app(centroA, ["magazzino.fse.monitoring.manage"]);
    const base = {
      magazzinoId: magazzinoA,
      annoMese: "2026-09",
      canaleUfficiale: "MENSA",
      dataRiferimento: "2026-09-30",
      fonte: "RILEVAZIONE_MANUALE_VERIFICATA",
      completezza: "PARZIALE",
    };
    expect(
      (
        await request(client)
          .post("/fse/monitoraggio")
          .send({ ...base, operazioneDistribuzioneId: foreignOperation.id })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(client)
          .post("/fse/monitoraggio")
          .send({ ...base, fonte: "ARBITRARIA" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(client)
          .post("/fse/monitoraggio")
          .send({ ...base, completezza: "IGNOTA" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(client)
          .post("/fse/monitoraggio")
          .send({ ...base, dataRiferimento: "2026-10-01" })
      ).status,
    ).toBe(400);
  });

  it("valida il limite massimo della paginazione", async () => {
    const response = await request(app(centroA, ["magazzino.fse.view"]))
      .get("/fse/exportazioni")
      .query({ pageSize: 201 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Paginazione/);
  });

  it("registra un reso OpC idempotente su Lotto esatto e lo storna con compensazione", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto(scope, {
      prodottoId,
      magazzinoId: magazzinoA,
      quantita: 10,
      fsePlus: true,
    });
    const payload = {
      versione: 1,
      idempotencyKey: `reso-opc-${lottoId}`,
      magazzinoId: magazzinoA,
      dataReso: "2026-08-20",
      destinazioneOpc: "OpC provinciale test",
      motivazione: "Richiamo amministrativo della fornitura",
      modalitaSelezione: "PARTITA_ESATTA",
      righe: [{ prodottoId, lottoId, quantita: 4 }],
    };

    expect(
      (
        await request(app(centroA, ["magazzino.fse.view"]))
          .post("/fse/resi-opc")
          .send(payload)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app(centroA, ["magazzino.fse.return"]))
          .post("/fse/resi-opc")
          .send({ ...payload, versione: undefined })
      ).status,
    ).toBe(400);

    const client = app(centroA, ["magazzino.fse.return"]);
    const concurrentSamePayload = await Promise.all([
      request(client).post("/fse/resi-opc").send(payload),
      request(client).post("/fse/resi-opc").send(payload),
    ]);
    expect(
      concurrentSamePayload.map((response) => response.status).sort(),
    ).toEqual([200, 201]);
    const created = concurrentSamePayload.find(
      (response) => response.status === 201,
    )!;
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      magazzinoId: magazzinoA,
      destinazioneOpc: payload.destinazioneOpc,
      motivazione: payload.motivazione,
      stato: "REGISTRATO",
      versione: 1,
      idempotentReplay: false,
    });
    scope.scaricoIds.push(created.body.id);

    const replay = await request(client).post("/fse/resi-opc").send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      id: created.body.id,
      versione: 1,
      idempotentReplay: true,
    });
    const differentPayload = await request(client)
      .post("/fse/resi-opc")
      .send({
        ...payload,
        righe: [{ prodottoId, lottoId, quantita: 3 }],
      });
    expect(differentPayload.status).toBe(409);

    const conflictLotId = await createLotto(scope, {
      prodottoId,
      magazzinoId: magazzinoA,
      quantita: 10,
      fsePlus: true,
    });
    const conflictKey = `${payload.idempotencyKey}-conflict`;
    const concurrentDifferentPayload = await Promise.all([
      request(client)
        .post("/fse/resi-opc")
        .send({
          ...payload,
          idempotencyKey: conflictKey,
          righe: [{ prodottoId, lottoId: conflictLotId, quantita: 1 }],
        }),
      request(client)
        .post("/fse/resi-opc")
        .send({
          ...payload,
          idempotencyKey: conflictKey,
          righe: [{ prodottoId, lottoId: conflictLotId, quantita: 2 }],
        }),
    ]);
    expect(
      concurrentDifferentPayload.map((response) => response.status).sort(),
    ).toEqual([201, 409]);
    scope.scaricoIds.push(
      concurrentDifferentPayload.find((response) => response.status === 201)!
        .body.id,
    );

    const [afterReturn] = await db
      .select({ quantity: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    expect(Number(afterReturn.quantity)).toBe(6);
    const [movement] = await db
      .select()
      .from(movimentiTable)
      .where(
        and(
          eq(movimentiTable.entitaOrigineTipo, "reso_opc"),
          eq(movimentiTable.entitaOrigineId, created.body.id),
        ),
      );
    expect(movement).toMatchObject({
      lottoId,
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "RESO",
    });
    expect(Number(movement.quantita)).toBe(4);

    expect(
      (
        await request(client)
          .post(`/fse/resi-opc/${created.body.id}/storno`)
          .send({ data: "2026-08-21", motivazione: "Errore test" })
      ).status,
    ).toBe(400);
    const reversed = await request(client)
      .post(`/fse/resi-opc/${created.body.id}/storno`)
      .send({
        versione: 1,
        data: "2026-08-21",
        motivazione: "Errore di registrazione verificato",
      });
    expect(reversed.status).toBe(200);
    expect(reversed.body).toMatchObject({ stato: "STORNATO", versione: 2 });
    expect(
      (
        await request(client)
          .post(`/fse/resi-opc/${created.body.id}/storno`)
          .send({
            versione: 1,
            data: "2026-08-21",
            motivazione: "Replay non ammesso",
          })
      ).status,
    ).toBe(409);

    const [afterReversal] = await db
      .select({ quantity: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    expect(Number(afterReversal.quantity)).toBe(10);
    const [compensation] = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.movimentoOrigineId, movement.id));
    expect(compensation).toMatchObject({
      tipoMovimento: "rettifica_positiva",
      naturaContabile: "STORNO",
      fondoOrigine: "FSE_PLUS",
    });
    expect(Number(compensation.quantita)).toBe(4);

    const concurrentLottoId = await createLotto(scope, {
      prodottoId,
      magazzinoId: magazzinoA,
      quantita: 3,
      fsePlus: true,
    });
    const concurrentPayload = {
      ...payload,
      idempotencyKey: `reso-opc-concurrent-${concurrentLottoId}`,
      righe: [{ prodottoId, lottoId: concurrentLottoId, quantita: 1 }],
    };
    const concurrent = await Promise.all([
      request(client).post("/fse/resi-opc").send(concurrentPayload),
      request(client).post("/fse/resi-opc").send(concurrentPayload),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    const concurrentIds = new Set(
      concurrent.map((response) => Number(response.body.id)),
    );
    expect(concurrentIds.size).toBe(1);
    scope.scaricoIds.push(Number(concurrent[0].body.id));
    const [afterConcurrent] = await db
      .select({ quantity: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, concurrentLottoId));
    expect(Number(afterConcurrent.quantity)).toBe(2);
  });
});
