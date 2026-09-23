import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import express from "express";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  bolleTable,
  bollaRigheTable,
  db,
  entiDestinatariTable,
  interventiTable,
  lottiTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prenotazioniMagazzinoTable,
  trasferimentiTable,
} from "@workspace/db";
import bolleRouter from "../src/routes/bolle";
import documentiRouter from "../src/routes/documenti-operativi";
import entiRouter from "../src/routes/enti-destinatari";
import trasferimentiRouter from "../src/routes/trasferimenti";
import lottiRouter from "../src/routes/lotti";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createLotto,
  createMagazzino,
  createMagazzinoRec,
  createProdotto,
  createUtente,
  createZona,
  insertTrasferimento,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let boot: SeedScope;
let scope: SeedScope;
let operatoreId: number;
let areaId: number;
let magazzinoId: number;
let prodottoId: number;
let lottoId: number;

const app = () => {
  const router = express.Router();
  router.use(entiRouter, bolleRouter, documentiRouter);
  return makeScopedApp(router, {
    id: operatoreId,
    centroAscoltoId: null,
    areaOperativaId: areaId,
  });
};

const appWithPermissions = (permessi: string[], aree: string[]) => {
  const router = express.Router();
  router.use(documentiRouter, trasferimentiRouter);
  return makeScopedApp(router, {
    id: operatoreId,
    centroAscoltoId: null,
    areaOperativaId: areaId,
    permessi,
    aree,
  });
};

function parseBinary(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
}

const commandKey = (label: string) => `${label}-${randomUUID()}`;

beforeAll(async () => {
  boot = newScope();
  operatoreId = await createUtente(boot, {});
});

beforeEach(async () => {
  scope = newScope();
  areaId = await createAreaOperativa(scope);
  const centro = await createCentroRec(scope, { areaOperativaId: areaId });
  magazzinoId = await createMagazzino(scope, centro.id, {
    areaOperativaId: areaId,
  });
  prodottoId = await createProdotto(scope);
  lottoId = await createLotto(scope, { prodottoId, magazzinoId, quantita: 10 });
});

afterEach(async () => {
  await cleanup(scope);
});
afterAll(async () => {
  await cleanup(boot);
  await pool.end();
});

describe("M4A — destinatario Ente e facciata documentale", () => {
  it("LOT-EX-03: il lotto prenotato non è disponibile né selezionabile per il Trasferimento", async () => {
    const earlyLot = await createLotto(scope, {
      prodottoId,
      magazzinoId,
      quantita: 10,
      dataScadenza: "2027-01-01",
    });
    const bookedLot = await createLotto(scope, {
      prodottoId,
      magazzinoId,
      quantita: 10,
      dataScadenza: "2027-06-01",
    });
    const [entity] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente prenotante",
        indirizzo: "Via Test",
        areaOperativaId: areaId,
      })
      .returning();
    scope.enteDestinatarioIds.push(entity.id);
    const [bolla] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `BOOK-${randomUUID().slice(0, 8)}`,
        dataBolla: "2026-09-22",
        tipoDestinatario: "ente",
        enteDestinatarioId: entity.id,
        magazzinoId,
        areaOperativaIdSnapshot: areaId,
        stato: "confermato",
      })
      .returning();
    scope.bollaIds.push(bolla.id);
    const [bollaRow] = await db
      .insert(bollaRigheTable)
      .values({
        bollaId: bolla.id,
        prodottoId,
        lottoId: bookedLot,
        quantita: "8",
        unitaMisura: "kg",
      })
      .returning();
    await db.insert(prenotazioniMagazzinoTable).values({
      bollaId: bolla.id,
      rigaBollaId: bollaRow.id,
      prodottoId,
      lottoId: bookedLot,
      magazzinoId,
      quantita: "8",
      stato: "attiva",
    });
    const centroDestino = await createCentroRec(scope, {
      areaOperativaId: areaId,
    });
    const destination = await createMagazzino(scope, centroDestino.id, {
      areaOperativaId: areaId,
    });
    const router = express.Router();
    router.use(lottiRouter, trasferimentiRouter);
    const warehouseApp = makeScopedApp(router, {
      id: operatoreId,
      centroAscoltoId: null,
      areaOperativaId: areaId,
      permessi: [
        "magazzino.view",
        "magazzino.transfers.create",
        "magazzino.transfers.prepare",
        "magazzino.transfers.dispatch",
      ],
      aree: ["magazzino"],
    });
    const available = await request(warehouseApp)
      .get("/lotti")
      .query({ prodottoId, magazzinoId });
    expect(available.status, available.text).toBe(200);
    expect(
      available.body.find((lotto: { id: number }) => lotto.id === bookedLot)
        .disponibileReale,
    ).toBe(2);
    const detail = await request(warehouseApp).get(`/lotti/${bookedLot}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body).toMatchObject({
      id: bookedLot,
      disponibileReale: 2,
      disponibileRealePrecisa: "2.000000",
    });
    const created = await request(warehouseApp)
      .post("/trasferimenti")
      .send({
        idempotencyKey: commandKey("booked-transfer"),
        magazzinoOrigineId: magazzinoId,
        magazzinoDestinoId: destination,
        dataRichiesta: "2026-09-22",
        trasportatoreNome: "Test prenotato",
        righe: [
          { prodottoId, lottoId: bookedLot, quantita: 5, unitaMisura: "kg" },
        ],
      });
    expect(created.status, created.text).toBe(201);
    scope.trasferimentoIds.push(created.body.id);
    const started = await request(warehouseApp)
      .post(`/trasferimenti/${created.body.id}/prepara`)
      .send({
        idempotencyKey: commandKey("booked-dispatch"),
        versione: created.body.versione,
      });
    expect(started.status, started.text).toBe(409);
    expect(
      Number(
        (
          await db
            .select({ quantity: lottiTable.quantitaResidua })
            .from(lottiTable)
            .where(eq(lottiTable.id, bookedLot))
        )[0].quantity,
      ),
    ).toBe(10);
    expect(
      Number(
        (
          await db
            .select({ quantity: lottiTable.quantitaResidua })
            .from(lottiTable)
            .where(eq(lottiTable.id, earlyLot))
        )[0].quantity,
      ),
    ).toBe(10);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.trasferimentoId, created.body.id)),
    ).toHaveLength(0);
  });
  it("UDS-ENTE-01/02 e UDS-BEN-REG-01: lista, dettaglio ed export rispettano Area/Magazzino senza applicare Zona all'Ente", async () => {
    const zonaA1 = await createZona(scope, areaId);
    const zonaA2 = await createZona(scope, areaId);
    const areaB = await createAreaOperativa(scope);
    await createZona(scope, areaB);
    const centroB = await createCentroRec(scope, { areaOperativaId: areaB });
    const magazzinoB = await createMagazzino(scope, centroB.id, {
      areaOperativaId: areaB,
    });
    const [enteA, enteB] = await db
      .insert(entiDestinatariTable)
      .values([
        {
          denominazione: "Ente Area A",
          indirizzo: "Via A 1",
          areaOperativaId: areaId,
        },
        {
          denominazione: "Ente Area B",
          indirizzo: "Via B 1",
          areaOperativaId: areaB,
        },
      ])
      .returning();
    scope.enteDestinatarioIds.push(enteA.id, enteB.id);
    const beneficiarioA2 = await createBeneficiario(scope, null, {
      areaOperativaId: areaId,
      zonaUdsId: zonaA2.id,
      uds: true,
    });
    const unique = randomUUID().slice(0, 8);
    const [bollaA, bollaB, bollaBeneficiario] = await db
      .insert(bolleTable)
      .values([
        {
          numeroBolla: `UDSA-${unique}`,
          dataBolla: "2026-09-22",
          tipoDestinatario: "ente",
          enteDestinatarioId: enteA.id,
          magazzinoId,
          areaOperativaIdSnapshot: areaId,
        },
        {
          numeroBolla: `UDSB-${unique}`,
          dataBolla: "2026-09-22",
          tipoDestinatario: "ente",
          enteDestinatarioId: enteB.id,
          magazzinoId: magazzinoB,
          areaOperativaIdSnapshot: areaB,
        },
        {
          numeroBolla: `UDSX-${unique}`,
          dataBolla: "2026-09-22",
          tipoDestinatario: "beneficiario",
          beneficiarioId: beneficiarioA2,
          magazzinoId,
          areaOperativaIdSnapshot: areaId,
        },
      ])
      .returning();
    scope.bollaIds.push(bollaA.id, bollaB.id, bollaBeneficiario.id);
    const restrictedRouter = express.Router();
    restrictedRouter.use(bolleRouter, documentiRouter);
    const restricted = makeScopedApp(restrictedRouter, {
      id: operatoreId,
      centroAscoltoId: null,
      areaOperativaId: areaId,
      zonaUdsId: zonaA1.id,
      permessi: ["bolle.view", "bolle.manage"],
      aree: ["magazzino"],
    });

    const bolleList = await request(restricted).get("/bolle");
    expect(bolleList.status, bolleList.text).toBe(200);
    expect(bolleList.body.map((row: { id: number }) => row.id)).toContain(
      bollaA.id,
    );
    expect(bolleList.body.map((row: { id: number }) => row.id)).not.toContain(
      bollaB.id,
    );
    expect(bolleList.body.map((row: { id: number }) => row.id)).not.toContain(
      bollaBeneficiario.id,
    );

    const commonList = await request(restricted).get("/documenti-operativi");
    expect(commonList.status, commonList.text).toBe(200);
    const identities = commonList.body.items.map(
      (row: { documentoId: string }) => row.documentoId,
    );
    expect(identities).toContain(`bolla:${bollaA.id}`);
    expect(identities).not.toContain(`bolla:${bollaB.id}`);
    expect(identities).not.toContain(`bolla:${bollaBeneficiario.id}`);

    for (const path of ["/bolle", "/documenti-operativi/bolla"]) {
      expect(
        (await request(restricted).get(`${path}/${bollaA.id}`)).status,
      ).toBe(200);
      expect(
        (await request(restricted).get(`${path}/${bollaB.id}`)).status,
      ).toBe(403);
      expect(
        (await request(restricted).get(`${path}/${bollaBeneficiario.id}`))
          .status,
      ).toBe(403);
    }
    const changed = await request(restricted)
      .patch(`/bolle/${bollaA.id}`)
      .send({
        idempotencyKey: commandKey("uds-ente-update"),
        versione: bollaA.versione,
        noteConsegna: "Scope Ente verificato sotto lock",
      });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.noteConsegna).toBe("Scope Ente verificato sotto lock");
    expect(
      (
        await request(restricted)
          .patch(`/bolle/${bollaB.id}`)
          .send({
            idempotencyKey: commandKey("uds-ente-forbidden"),
            versione: bollaB.versione,
            noteConsegna: "non ammesso",
          })
      ).status,
    ).toBe(403);
    const exported = await request(restricted)
      .get("/documenti-operativi/export.xlsx")
      .buffer(true)
      .parse(parseBinary);
    expect(exported.status, exported.text).toBe(200);
    const workbook = XLSX.read(exported.body, { type: "buffer" });
    const exportedIds = XLSX.utils
      .sheet_to_json<
        Record<string, unknown>
      >(workbook.Sheets[workbook.SheetNames[0]], { raw: true })
      .map((row) => row["Identità"]);
    expect(exportedIds).toContain(`bolla:${bollaA.id}`);
    expect(exportedIds).not.toContain(`bolla:${bollaB.id}`);
    expect(exportedIds).not.toContain(`bolla:${bollaBeneficiario.id}`);

    const zoneWithoutArea = makeScopedApp(restrictedRouter, {
      id: operatoreId,
      centroAscoltoId: null,
      areaOperativaId: null,
      zonaUdsId: zonaA1.id,
      permessi: ["bolle.view"],
      aree: ["magazzino"],
    });
    const missingAreaList = await request(zoneWithoutArea).get("/bolle");
    expect(missingAreaList.status).toBe(200);
    expect(
      missingAreaList.body.map((row: { id: number }) => row.id),
    ).not.toContain(bollaA.id);
    const missingAreaCommon = await request(zoneWithoutArea).get(
      "/documenti-operativi",
    );
    expect(missingAreaCommon.status).toBe(200);
    expect(
      missingAreaCommon.body.items.map(
        (row: { documentoId: string }) => row.documentoId,
      ),
    ).not.toContain(`bolla:${bollaA.id}`);
    expect(
      (
        await request(zoneWithoutArea).get(
          `/documenti-operativi/bolla/${bollaA.id}`,
        )
      ).status,
    ).toBe(403);
  });
  it("protegge creazione e modifica Ente con replay, hash, versione e scope correnti", async () => {
    const createKey = commandKey("ente-create-replay");
    const createPayload = {
      idempotencyKey: createKey,
      denominazione: "Ente idempotente",
      indirizzo: "Via Idempotenza 1",
      areaOperativaId: areaId,
    };
    const created = await request(app())
      .post("/enti-destinatari")
      .send(createPayload);
    expect(created.status, created.text).toBe(201);
    scope.enteDestinatarioIds.push(created.body.id);

    const createReplay = await request(app())
      .post("/enti-destinatari")
      .send(createPayload);
    expect(createReplay.status, createReplay.text).toBe(200);
    expect(createReplay.body).toMatchObject({
      id: created.body.id,
      versione: 1,
    });
    const createMismatch = await request(app())
      .post("/enti-destinatari")
      .send({ ...createPayload, denominazione: "Payload differente" });
    expect(createMismatch.status).toBe(409);

    const updateKey = commandKey("ente-update-replay");
    const updatePayload = {
      idempotencyKey: updateKey,
      versione: created.body.versione,
      telefono: "06 123456",
    };
    const updated = await request(app())
      .patch(`/enti-destinatari/${created.body.id}`)
      .send(updatePayload);
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body).toMatchObject({ versione: 2, telefono: "06 123456" });

    const updateReplay = await request(app())
      .patch(`/enti-destinatari/${created.body.id}`)
      .send(updatePayload);
    expect(updateReplay.status, updateReplay.text).toBe(200);
    expect(updateReplay.body.versione).toBe(2);
    expect(
      (
        await request(app())
          .patch(`/enti-destinatari/${created.body.id}`)
          .send({ ...updatePayload, telefono: "06 999999" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app())
          .patch(`/enti-destinatari/${created.body.id}`)
          .send({
            idempotencyKey: commandKey("ente-update-stale"),
            versione: 1,
            email: "stale@example.test",
          })
      ).status,
    ).toBe(409);

    const concurrentKey = commandKey("ente-update-concurrent");
    const concurrentPayload = {
      idempotencyKey: concurrentKey,
      versione: 2,
      email: "ente@example.test",
    };
    const concurrent = await Promise.all([
      request(app())
        .patch(`/enti-destinatari/${created.body.id}`)
        .send(concurrentPayload),
      request(app())
        .patch(`/enti-destinatari/${created.body.id}`)
        .send(concurrentPayload),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 200,
    ]);
    const [persisted] = await db
      .select()
      .from(entiDestinatariTable)
      .where(eq(entiDestinatariTable.id, created.body.id));
    expect(persisted).toMatchObject({
      versione: 3,
      email: "ente@example.test",
    });

    const originalAreaId = areaId;
    const revokedAreaId = await createAreaOperativa(scope);
    areaId = revokedAreaId;
    try {
      const deniedReplay = await request(app())
        .patch(`/enti-destinatari/${created.body.id}`)
        .send(concurrentPayload);
      expect(deniedReplay.status).toBe(403);
    } finally {
      areaId = originalAreaId;
    }
  });

  it("separa i rami autorizzativi prima di conteggio e paginazione", async () => {
    const secondoCentro = await createCentroRec(scope, {
      areaOperativaId: areaId,
    });
    const destinazioneId = await createMagazzino(scope, secondoCentro.id, {
      areaOperativaId: areaId,
    });
    const trasferimentoId = await insertTrasferimento(scope, {
      origineId: magazzinoId,
      destinoId: destinazioneId,
    });
    const [ente] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente autorizzazioni M4A",
        indirizzo: "Via Autorizzazioni 1",
        areaOperativaId: areaId,
      })
      .returning();
    scope.enteDestinatarioIds.push(ente.id);
    const bolla = await request(app())
      .post("/bolle")
      .send({
        idempotencyKey: commandKey("bolla-auth"),
        tipoDestinatario: "ente",
        enteDestinatarioId: ente.id,
        magazzinoId,
      });
    expect(bolla.status).toBe(201);
    scope.bollaIds.push(bolla.body.id);

    const transferOnly = appWithPermissions(["magazzino.view"], ["magazzino"]);
    const transferList = await request(transferOnly)
      .get("/documenti-operativi")
      .query({ page: 1, limit: 1 });
    expect(transferList.status).toBe(200);
    expect(transferList.body.total).toBe(1);
    expect(transferList.headers["x-total-count"]).toBe("1");
    expect(transferList.body.items).toEqual([
      expect.objectContaining({
        documentoId: `trasferimento:${trasferimentoId}`,
        tipoAggregato: "trasferimento",
      }),
    ]);
    expect(
      (
        await request(transferOnly).get(
          `/documenti-operativi/trasferimento/${trasferimentoId}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(transferOnly).get(
          `/documenti-operativi/bolla/${bolla.body.id}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(transferOnly).post("/trasferimenti").send({
          magazzinoOrigineId: magazzinoId,
          magazzinoDestinoId: destinazioneId,
          righe: [],
        })
      ).status,
    ).toBe(403);

    const bolleOnly = appWithPermissions(["bolle.view"], ["sociale"]);
    const bolleList = await request(bolleOnly)
      .get("/documenti-operativi")
      .query({ page: 1, limit: 1 });
    expect(bolleList.status).toBe(200);
    expect(bolleList.body.total).toBe(1);
    expect(bolleList.headers["x-total-count"]).toBe("1");
    expect(bolleList.body.items).toEqual([
      expect.objectContaining({
        documentoId: `bolla:${bolla.body.id}`,
        tipoAggregato: "bolla",
      }),
    ]);
    expect(
      (
        await request(bolleOnly).get(
          `/documenti-operativi/bolla/${bolla.body.id}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(bolleOnly).get(
          `/documenti-operativi/trasferimento/${trasferimentoId}`,
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await request(appWithPermissions([], ["magazzino"]))
          .get("/documenti-operativi")
          .query({ page: 1, limit: 1 })
      ).status,
    ).toBe(403);
  });

  it("applica gli stessi filtri, scope e ordinamento stabile a lista, conteggio ed export", async () => {
    const secondoCentro = await createCentroRec(scope, {
      areaOperativaId: areaId,
    });
    const destinazione = await createMagazzinoRec(scope, secondoCentro.id, {
      areaOperativaId: areaId,
    });
    const [ente] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente dataset documentale M4A",
        indirizzo: "Via Dataset 1",
        telefono: "000-PII-NON-RICERCABILE",
        areaOperativaId: areaId,
      })
      .returning();
    scope.enteDestinatarioIds.push(ente.id);

    const collisionId = 1_000_000_000 + Math.floor(Math.random() * 900_000_000);
    const timestamp = new Date("2026-09-18T09:00:00.000Z");
    const bollaIds = [collisionId, collisionId + 1];
    const trasferimentoIds = [collisionId, collisionId + 1];
    await db.insert(bolleTable).values(
      bollaIds.map((id, index) => ({
        id,
        numeroBolla: `BOL-${collisionId}-${index + 1}`,
        dataBolla: "2026-09-18",
        tipoDestinatario: "ente",
        beneficiarioId: null,
        enteDestinatarioId: ente.id,
        magazzinoId,
        areaOperativaIdSnapshot: areaId,
        stato: "bozza",
        dataCreazione: timestamp,
      })),
    );
    scope.bollaIds.push(...bollaIds);
    await db.insert(trasferimentiTable).values(
      trasferimentoIds.map((id, index) => ({
        id,
        codice: `TRF-${collisionId}-${index + 1}`,
        magazzinoOrigineId: magazzinoId,
        magazzinoDestinoId: destinazione.id,
        dataRichiesta: "2026-09-18",
        stato: "richiesto",
        note: index === 0 ? "NOTA-PRIVATA-NON-RICERCABILE" : null,
        dataCreazione: timestamp,
      })),
    );
    scope.trasferimentoIds.push(...trasferimentoIds);

    const altraAreaId = await createAreaOperativa(scope);
    const altroCentro = await createCentroRec(scope, {
      areaOperativaId: altraAreaId,
    });
    const altroMagazzino = await createMagazzino(scope, altroCentro.id, {
      areaOperativaId: altraAreaId,
    });
    const altroMagazzinoDestinazione = await createMagazzino(
      scope,
      altroCentro.id,
      { areaOperativaId: altraAreaId },
    );
    const [altroEnte] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente fuori scope M4A",
        indirizzo: "Via Fuori Scope 1",
        areaOperativaId: altraAreaId,
      })
      .returning();
    scope.enteDestinatarioIds.push(altroEnte.id);
    const outsideBollaId = collisionId + 50;
    const outsideTransferId = collisionId + 50;
    await db.insert(bolleTable).values({
      id: outsideBollaId,
      numeroBolla: `BOL-FUORI-${collisionId}`,
      dataBolla: "2026-09-18",
      tipoDestinatario: "ente",
      enteDestinatarioId: altroEnte.id,
      magazzinoId: altroMagazzino,
      areaOperativaIdSnapshot: altraAreaId,
      stato: "bozza",
      dataCreazione: timestamp,
    });
    scope.bollaIds.push(outsideBollaId);
    await db.insert(trasferimentiTable).values({
      id: outsideTransferId,
      codice: `TRF-FUORI-${collisionId}`,
      magazzinoOrigineId: altroMagazzino,
      magazzinoDestinoId: altroMagazzinoDestinazione,
      dataRichiesta: "2026-09-18",
      stato: "richiesto",
      dataCreazione: timestamp,
    });
    scope.trasferimentoIds.push(outsideTransferId);

    const firstPage = await request(app())
      .get("/documenti-operativi")
      .query({ page: 1, limit: 2 });
    const secondPage = await request(app())
      .get("/documenti-operativi")
      .query({ page: 2, limit: 2 });
    expect(firstPage.status, firstPage.text).toBe(200);
    expect(secondPage.status, secondPage.text).toBe(200);
    expect(firstPage.body.total).toBe(4);
    expect(secondPage.body.total).toBe(4);
    expect(
      [...firstPage.body.items, ...secondPage.body.items].map(
        (row: { documentoId: string }) => row.documentoId,
      ),
    ).toEqual([
      `bolla:${collisionId + 1}`,
      `bolla:${collisionId}`,
      `trasferimento:${collisionId + 1}`,
      `trasferimento:${collisionId}`,
    ]);
    const emptyPage = await request(app())
      .get("/documenti-operativi")
      .query({ page: 99, limit: 2 });
    expect(emptyPage.status, emptyPage.text).toBe(200);
    expect(emptyPage.body.items).toEqual([]);
    expect(emptyPage.body.total).toBe(4);

    const cases = [
      [{ tipoAggregato: "bolla" }, 2],
      [{ destinatario: "magazzino" }, 2],
      [{ stato: "bozza" }, 2],
      [{ areaOperativaId: areaId }, 4],
      [{ magazzinoId: destinazione.id }, 2],
      [{ dataDa: "2026-09-18", dataA: "2026-09-18" }, 4],
      [{ dataDa: "2026-09-19" }, 0],
      [{ ricerca: destinazione.nome }, 2],
      [{ ricerca: `TRF-${collisionId}-1` }, 1],
      [{ ricerca: "NOTA-PRIVATA-NON-RICERCABILE" }, 0],
      [{ ricerca: "000-PII-NON-RICERCABILE" }, 0],
    ] as const;
    for (const [query, expected] of cases) {
      const response = await request(app())
        .get("/documenti-operativi")
        .query({ ...query, page: 1, limit: 10 });
      expect(response.status, response.text).toBe(200);
      expect(response.body.total).toBe(expected);
      expect(response.body.items).toHaveLength(expected);
    }

    const byNumber = await request(app()).get("/documenti-operativi").query({
      page: 1,
      limit: 10,
      sortBy: "numero",
      sortDirection: "asc",
    });
    expect(
      byNumber.body.items.map((row: { numero: string }) => row.numero),
    ).toEqual([
      `BOL-${collisionId}-1`,
      `BOL-${collisionId}-2`,
      `TRF-${collisionId}-1`,
      `TRF-${collisionId}-2`,
    ]);

    const exported = await request(app())
      .get("/documenti-operativi/export.xlsx")
      .query({
        tipoAggregato: "trasferimento",
        page: 1,
        limit: 1,
      })
      .buffer(true)
      .parse(parseBinary);
    expect(exported.status, exported.text).toBe(200);
    expect(exported.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const workbook = XLSX.read(exported.body, { type: "buffer" });
    const exportedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[workbook.SheetNames[0]],
      { raw: true },
    );
    expect(exportedRows).toHaveLength(2);
    expect(exportedRows.map((row) => row["Identità"])).toEqual([
      `trasferimento:${collisionId + 1}`,
      `trasferimento:${collisionId}`,
    ]);
    expect(exportedRows.map((row) => row["Numero"])).not.toContain(
      `TRF-FUORI-${collisionId}`,
    );
  });

  it("rifiuta filtri, date, ordinamenti e paginazione non validi", async () => {
    const invalidQueries: Array<Record<string, unknown>> = [
      { tipoAggregato: "altro" },
      { destinatario: "altro" },
      { areaOperativaId: 0 },
      { magazzinoId: "1.5" },
      { centroAscoltoId: -1 },
      { dataDa: "2026-02-30" },
      { dataDa: "2026-09-19", dataA: "2026-09-18" },
      { ricerca: "x".repeat(121) },
      { sortBy: "destinatario" },
      { sortDirection: "sideways" },
      { page: 0 },
      { limit: 101 },
      { tipoAggregato: ["bolla", "trasferimento"] },
    ];
    for (const query of invalidQueries) {
      const response = await request(app())
        .get("/documenti-operativi")
        .query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
    }
    expect(
      (
        await request(app())
          .get("/documenti-operativi/export.xlsx")
          .query({ sortDirection: "sideways" })
      ).status,
    ).toBe(400);
  });

  it("rifiuta riferimenti destinatario combinati", async () => {
    const [ente] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente M4A",
        indirizzo: "Via Test 1",
        areaOperativaId: areaId,
      })
      .returning();
    scope.enteDestinatarioIds.push(ente.id);
    const response = await request(app())
      .post("/bolle")
      .send({
        idempotencyKey: commandKey("bolla-destinatari-invalid"),
        tipoDestinatario: "ente",
        enteDestinatarioId: ente.id,
        beneficiarioId: 999,
        magazzinoId,
      });
    expect(response.status).toBe(400);
  });

  it("crea la bozza Ente senza effetti e consegna con natura dedicata senza fatti sociali", async () => {
    const enteLottoId = await createLotto(scope, {
      prodottoId,
      magazzinoId,
      quantita: 30,
    });
    const createdEntity = await request(app())
      .post("/enti-destinatari")
      .send({
        idempotencyKey: commandKey("ente-create"),
        denominazione: "Associazione destinataria",
        indirizzo: "Via Solidale 12",
        areaOperativaId: areaId,
      });
    expect(createdEntity.status).toBe(201);
    scope.enteDestinatarioIds.push(createdEntity.body.id);

    const created = await request(app())
      .post("/bolle")
      .send({
        idempotencyKey: commandKey("bolla-ente"),
        tipoDestinatario: "ente",
        enteDestinatarioId: createdEntity.body.id,
        magazzinoId,
      });
    expect(created.status).toBe(201);
    scope.bollaIds.push(created.body.id);
    expect(
      await db
        .select()
        .from(prenotazioniMagazzinoTable)
        .where(eq(prenotazioniMagazzinoTable.bollaId, created.body.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, created.body.id)),
    ).toHaveLength(0);

    const rowAdded = await request(app())
      .post(`/bolle/${created.body.id}/righe`)
      .send({
        idempotencyKey: commandKey("bolla-riga"),
        versione: created.body.versione,
        prodottoId,
        lottoId: enteLottoId,
        quantita: "4",
        unitaMisura: "kg",
      });
    expect(rowAdded.status, rowAdded.text).toBe(201);
    const confirmed = await request(app())
      .post(`/bolle/${created.body.id}/conferma`)
      .send({
        idempotencyKey: commandKey("bolla-conferma"),
        versione: rowAdded.body.versioneBolla,
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    const [lottoPrenotato] = await db
      .select({ residuo: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, enteLottoId));
    expect(Number(lottoPrenotato.residuo)).toBe(30);
    const prenotazioni = await db
      .select()
      .from(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.bollaId, created.body.id));
    expect(prenotazioni).toHaveLength(1);
    expect(Number(prenotazioni[0].quantita)).toBe(4);
    const delivered = await request(app())
      .post(`/bolle/${created.body.id}/consegna`)
      .send({
        idempotencyKey: commandKey("bolla-consegna"),
        versione: confirmed.body.versione,
        confermaRicezione: true,
      });
    expect(delivered.status, delivered.text).toBe(200);

    const [lottoConsegnato] = await db
      .select({ residuo: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, enteLottoId));
    expect(Number(lottoConsegnato.residuo)).toBe(26);

    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, created.body.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      naturaContabile: "CONSEGNA_ENTE",
      tipoDettaglio: "consegna_ente",
      beneficiarioId: null,
      quantita: expect.stringMatching(/^4(?:\.0+)?$/),
    });
    expect(
      await db
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.bollaId, created.body.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(operazioniDistribuzioneMagazzinoTable)
        .where(
          and(
            eq(
              operazioniDistribuzioneMagazzinoTable.entitaOrigineTipo,
              "bolla",
            ),
            eq(
              operazioniDistribuzioneMagazzinoTable.entitaOrigineId,
              created.body.id,
            ),
          ),
        ),
    ).toHaveLength(0);

    const list = await request(app()).get(
      "/documenti-operativi?destinatario=ente&page=1&limit=10",
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentoId: `bolla:${created.body.id}`,
          tipoDestinatario: "ente",
        }),
      ]),
    );
  });
});
