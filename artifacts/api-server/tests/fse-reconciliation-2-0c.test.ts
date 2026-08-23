/* @vitest-environment node */

import {
  db,
  importazioniAgeaRigheTable,
  importazioniAgeaTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prodottiTable,
  riconciliazioniFseRigheTable,
  riconciliazioniFseRisoluzioniTable,
  riconciliazioniFseTable,
  utentiTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  calculateFseReconciliation,
  currentExternalDelta,
  recalculateFseReconciliation,
  reconcileFseLines,
  selectLocalReconciliationDelta,
  type ReconciliationExternalLine,
  type ReconciliationLocalLine,
} from "../src/lib/fseReconciliation";
import fseRouter from "../src/routes/fse";
import { makeScopedApp } from "./scope-helpers";

function local(
  overrides: Partial<ReconciliationLocalLine> = {},
): ReconciliationLocalLine {
  return {
    movementId: 1,
    operationDistributionId: 10,
    caricoMagazzinoRigaId: null,
    eventKey: "DISTRIBUZIONE:10",
    lineKey: "MOVIMENTO:1",
    type: "DISTRIBUZIONE",
    fund: "FSE_PLUS",
    productId: 100,
    lot: "LOT-1",
    date: "2026-08-20",
    pieces: "-2.000000",
    kgLt: "-1.000000",
    channel: "PACCHI",
    packs: 1,
    meals: 0,
    occasional: 2,
    continuous: 0,
    ...overrides,
  };
}

function external(
  overrides: Partial<ReconciliationExternalLine> = {},
): ReconciliationExternalLine {
  return {
    importRowId: 20,
    externalMovementId: 30,
    caricoMagazzinoRigaId: null,
    type: "DISTRIBUZIONE",
    fund: "FSE_PLUS",
    productId: 100,
    lot: "LOT-1",
    date: "2026-08-20",
    pieces: "-2",
    kgLt: "-1",
    channel: "PACCHI",
    packs: 1,
    meals: 0,
    occasional: 2,
    continuous: 0,
    modified: false,
    ...overrides,
  };
}

describe("Magazzino 2.0C — matching riconciliazione", () => {
  it("applica link diretto, exact e multinsieme in ordine deterministico", () => {
    expect(
      reconcileFseLines(
        [local({ caricoMagazzinoRigaId: 99 })],
        [external({ caricoMagazzinoRigaId: 99 })],
      )[0],
    ).toMatchObject({
      matchMethod: "LINK_DIRETTO",
      status: "RICONCILIATA_ESATTA",
      blocking: false,
    });
    expect(reconcileFseLines([local()], [external()])[0].matchMethod).toBe(
      "EXACT_DETERMINISTICO",
    );
    const multi = reconcileFseLines(
      [local(), local({ movementId: 2, lineKey: "MOVIMENTO:2" })],
      [external(), external({ importRowId: 21 })],
    );
    expect(multi).toHaveLength(2);
    expect(multi.every((row) => row.matchMethod === "MULTINSIEME")).toBe(true);
  });

  it.each([
    [{ fund: "FONDO_NAZIONALE" }, "FONDO_DIFFERENTE"],
    [{ lot: "LOT-2" }, "LOTTO_DIFFERENTE"],
    [{ date: "2026-08-21" }, "DATA_DIFFERENTE"],
    [{ channel: "MENSA" }, "CANALE_DIFFERENTE"],
    [{ pieces: "-3" }, "QUANTITA_PEZZI_DIFFERENTE"],
    [{ kgLt: "-1.5" }, "QUANTITA_KGLT_DIFFERENTE"],
    [{ packs: 2 }, "STATISTICHE_DIFFERENTI"],
    [{ modified: true }, "MOVIMENTO_AGEA_MODIFICATO"],
  ] as Array<[Partial<ReconciliationExternalLine>, string]>)(
    "rileva lo scostamento %s",
    (change, expected) => {
      expect(reconcileFseLines([local()], [external(change)])[0]).toMatchObject(
        {
          status: expected,
          blocking: true,
        },
      );
    },
  );

  it("non auto-abbina identità ambigue e conserva gli elementi solo locali/AGEA", () => {
    const ambiguous = reconcileFseLines(
      [local(), local({ movementId: 2, lineKey: "MOVIMENTO:2", pieces: "-3" })],
      [external({ pieces: "-4" })],
    );
    expect(ambiguous.some((row) => row.status === "IDENTITA_AMBIGUA")).toBe(
      true,
    );
    const only = reconcileFseLines(
      [
        local({ type: "STORNO" }),
        local({ movementId: 2, lineKey: "MOVIMENTO:2", type: "RESO" }),
        local({
          movementId: 3,
          lineKey: "MOVIMENTO:3",
          type: "MODIFICA_GIACENZA",
        }),
      ],
      [external({ productId: null, importRowId: 99 })],
    );
    expect(only.map((row) => row.status)).toEqual(
      expect.arrayContaining([
        "STORNO_NON_RISCONTRATO",
        "RESO_NON_RISCONTRATO",
        "MODIFICA_GIACENZA_NON_RISCONTRATA",
        "PRODOTTO_NON_MAPPATO",
      ]),
    );
  });

  it("rileva AGEA scomparsi e Movimenti locali retrodatati successivi al cutoff", () => {
    const rowA = external({ importRowId: 20, externalMovementId: 30 });
    const rowB = external({ importRowId: 21, externalMovementId: 31 });
    const delta = currentExternalDelta([rowA], [rowA, rowB]);
    expect(delta.added).toHaveLength(0);
    expect(delta.missing).toEqual([rowB]);
    expect(
      selectLocalReconciliationDelta(
        [
          local({ movementId: 10, date: "2026-08-01" }),
          local({ movementId: 11, date: "2026-07-01" }),
        ],
        "2026-08-15",
        10,
      ).map((row) => row.movementId),
    ).toEqual([11]);
  });
});

const suffix = `${process.pid}${Date.now().toString(36)}`;
let userId: number;
let magazzinoId: number;
let prodottoId: number;
let lottoId: number;
let operationId: number;
let movementId: number;
let importId: number;
let importRowId: number;
let reconciliationId: number;

beforeAll(async () => {
  [{ id: userId }] = await db
    .insert(utentiTable)
    .values({
      username: `fse_rec_${suffix}`,
      passwordHash: "x",
      nome: "Test",
      cognome: "Recon",
    })
    .returning({ id: utentiTable.id });
  [{ id: magazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `FSER-${suffix}`.slice(0, 20),
      nome: `FSE recon ${suffix}`,
    })
    .returning({ id: magazziniTable.id });
  [{ id: prodottoId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `FSER-P-${suffix}`.slice(0, 30),
      nome: "Prodotto recon",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      gestioneLotto: true,
    })
    .returning({ id: prodottiTable.id });
  [{ id: lottoId }] = await db
    .insert(lottiTable)
    .values({
      prodottoId,
      codiceLotto: "LOT-REC",
      dataCarico: "2026-08-01",
      quantitaCaricata: "10",
      quantitaResidua: "8",
      magazzinoId,
      fsePlus: true,
      fondoOrigine: "FSE_PLUS",
    })
    .returning({ id: lottiTable.id });
  [{ id: operationId }] = await db
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values({
      magazzinoId,
      dataDistribuzione: "2026-08-20",
      canaleOperativo: "PACCHI",
      dominioOrigine: "TEST_RECON",
      entitaOrigineTipo: "FIXTURE",
      entitaOrigineId: Number(String(Date.now()).slice(-8)),
      numeroPacchi: 1,
      numeroPasti: 0,
      indigentiSaltuari: 2,
      indigentiContinuativi: 0,
      creatoDa: userId,
    })
    .returning({ id: operazioniDistribuzioneMagazzinoTable.id });
  [{ id: movementId }] = await db
    .insert(movimentiTable)
    .values({
      tipoMovimento: "scarico",
      tipoDettaglio: "distribuzione",
      dataMovimento: "2026-08-20",
      magazzinoId,
      prodottoId,
      lottoId,
      quantita: "2",
      quantitaPezzi: "2",
      quantitaKgLt: "1",
      unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      operazioneDistribuzioneId: operationId,
      canaleOperativo: "PACCHI",
    })
    .returning({ id: movimentiTable.id });
  [{ id: importId }] = await db
    .insert(importazioniAgeaTable)
    .values({
      magazzinoId,
      nomeFile: "fixture-recon.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dimensioneBytes: 100,
      sha256File: "a".repeat(64),
      tracciatoCodice: "SIFEAD_REGISTRO_XLSX_OSSERVATO_V1",
      parserVersion: "2.0B-R2.0",
      sheetName: "Table1",
      dataRiferimento: "2026-08-20",
      modalita: "SOLO_ANALISI",
      stato: "CONFERMATA",
      creatoDa: userId,
      confermatoDa: userId,
      dataConferma: new Date(),
    })
    .returning({ id: importazioniAgeaTable.id });
  [{ id: importRowId }] = await db
    .insert(importazioniAgeaRigheTable)
    .values({
      importazioneId: importId,
      numeroRiga: 2,
      rawJson: {},
      fondoRaw: "FSE+",
      fondoNormalizzato: "FSE_PLUS",
      prodottoRaw: "Prodotto recon",
      prodottoNormalizzato: "PRODOTTO RECON",
      lottoRaw: "LOT-REC",
      lottoNormalizzato: "LOT-REC",
      dataDocumento: "2026-08-20",
      movimentoPezzi: "-2",
      movimentoKgLt: "-1",
      attivitaNormalizzata: "PACCHI",
      pacchiRaw: "1",
      pastiRaw: "0",
      saltuariRaw: "2",
      continuativiRaw: "0",
      tipoMovimentoEsterno: "DISTRIBUZIONE",
      identityBaseHash: "b".repeat(64),
      identityOccurrence: 1,
      identityKey: `${"b".repeat(64)}:1`,
      contentHash: "c".repeat(64),
      prodottoIdSnapshot: prodottoId,
      statoRiga: "NUOVA",
      blocking: false,
    })
    .returning({ id: importazioniAgeaRigheTable.id });
});

afterAll(async () => {
  if (reconciliationId) {
    await db
      .delete(riconciliazioniFseRisoluzioniTable)
      .where(
        eq(
          riconciliazioniFseRisoluzioniTable.riconciliazioneId,
          reconciliationId,
        ),
      );
    await db
      .delete(riconciliazioniFseRigheTable)
      .where(
        eq(riconciliazioniFseRigheTable.riconciliazioneId, reconciliationId),
      );
    await db
      .delete(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.id, reconciliationId));
  }
  await db
    .delete(importazioniAgeaRigheTable)
    .where(eq(importazioniAgeaRigheTable.id, importRowId));
  await db
    .delete(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, importId));
  await db.delete(movimentiTable).where(eq(movimentiTable.id, movementId));
  await db
    .delete(operazioniDistribuzioneMagazzinoTable)
    .where(eq(operazioniDistribuzioneMagazzinoTable.id, operationId));
  await db.delete(lottiTable).where(eq(lottiTable.id, lottoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, magazzinoId));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await pool.end();
});

describe("Magazzino 2.0C — snapshot riconciliazione PostgreSQL", () => {
  it("calcola e ricalcola senza modificare stock, ledger o raw AGEA", async () => {
    const [beforeMovement] = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.id, movementId));
    const [beforeLot] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoId));
    const [beforeRaw] = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(eq(importazioniAgeaRigheTable.id, importRowId));
    const requestInput = {
      magazzinoId,
      importazioneAgeaId: importId,
      dataRiferimento: "2026-08-20",
      creatoDa: userId,
    };
    const concurrent = await Promise.all([
      calculateFseReconciliation(requestInput),
      calculateFseReconciliation(requestInput),
    ]);
    expect(new Set(concurrent.map((item) => item.reconciliation.id)).size).toBe(
      1,
    );
    expect(concurrent.filter((item) => item.replayed)).toHaveLength(1);
    const result = concurrent.find((item) => !item.replayed)!;
    reconciliationId = result.reconciliation.id;
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tipoRiga: "SALDO_PARTITA" }),
      ]),
    );
    expect(
      result.rows.find((row) => row.tipoRiga !== "SALDO_PARTITA"),
    ).toMatchObject({
      status: "RICONCILIATA_ESATTA",
      matchMethod: "EXACT_DETERMINISTICO",
    });
    const recalculated = await recalculateFseReconciliation({
      id: reconciliationId,
      versione: result.reconciliation.versione,
      actorId: userId,
    });
    expect(recalculated.reconciliation.versione).toBe(2);
    await expect(
      recalculateFseReconciliation({
        id: reconciliationId,
        versione: 1,
        actorId: userId,
      }),
    ).rejects.toThrow(/Versione/);
    expect(
      (
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.id, movementId))
      )[0],
    ).toEqual(beforeMovement);
    expect(
      (await db.select().from(lottiTable).where(eq(lottiTable.id, lottoId)))[0],
    ).toEqual(beforeLot);
    expect(
      (
        await db
          .select()
          .from(importazioniAgeaRigheTable)
          .where(eq(importazioniAgeaRigheTable.id, importRowId))
      )[0],
    ).toEqual(beforeRaw);
  });

  it("gestisce DISABBINA, RIAPRI e doppio ABBINA con una sola riga attiva", async () => {
    const api = makeScopedApp(fseRouter, {
      id: userId,
      centroAscoltoId: null,
      aree: ["magazzino"],
      permessi: [
        "magazzino.fse.view",
        "magazzino.fse.reconcile",
        "magazzino.fse.reconcile.manage",
      ],
      isAdmin: true,
    });
    let [header] = await db
      .select()
      .from(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.id, reconciliationId));
    let [pair] = await db
      .select()
      .from(riconciliazioniFseRigheTable)
      .where(
        and(
          eq(riconciliazioniFseRigheTable.riconciliazioneId, reconciliationId),
          eq(riconciliazioniFseRigheTable.movimentoId, movementId),
          eq(riconciliazioniFseRigheTable.active, true),
        ),
      );
    const disjoined = await request(api)
      .patch(`/fse/riconciliazioni/${reconciliationId}/righe/${pair.id}`)
      .send({
        versione: header.versione,
        azione: "DISABBINA",
        motivazione: "test lifecycle R2",
      });
    expect(disjoined.status, disjoined.text).toBe(200);
    let active = await db
      .select()
      .from(riconciliazioniFseRigheTable)
      .where(
        and(
          eq(riconciliazioniFseRigheTable.riconciliazioneId, reconciliationId),
          eq(riconciliazioniFseRigheTable.active, true),
        ),
      );
    expect(
      active.filter((row) => row.tipoRiga !== "SALDO_PARTITA"),
    ).toHaveLength(2);
    [header] = await db
      .select()
      .from(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.id, reconciliationId));
    const localCompanion = active.find(
      (row) => row.movimentoId === movementId,
    )!;
    const reopened = await request(api)
      .patch(
        `/fse/riconciliazioni/${reconciliationId}/righe/${localCompanion.id}`,
      )
      .send({
        versione: header.versione,
        azione: "RIAPRI",
        motivazione: "ripristino atomico R2",
      });
    expect(reopened.status, reopened.text).toBe(200);
    active = await db
      .select()
      .from(riconciliazioniFseRigheTable)
      .where(
        and(
          eq(riconciliazioniFseRigheTable.riconciliazioneId, reconciliationId),
          eq(riconciliazioniFseRigheTable.active, true),
        ),
      );
    expect(
      active.filter((row) => row.tipoRiga !== "SALDO_PARTITA"),
    ).toHaveLength(1);

    [header] = await db
      .select()
      .from(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.id, reconciliationId));
    pair = active.find((row) => row.movimentoId === movementId)!;
    await request(api)
      .patch(`/fse/riconciliazioni/${reconciliationId}/righe/${pair.id}`)
      .send({
        versione: header.versione,
        azione: "DISABBINA",
        motivazione: "prepara doppio ABBINA",
      });
    [header] = await db
      .select()
      .from(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.id, reconciliationId));
    active = await db
      .select()
      .from(riconciliazioniFseRigheTable)
      .where(
        and(
          eq(riconciliazioniFseRigheTable.riconciliazioneId, reconciliationId),
          eq(riconciliazioniFseRigheTable.active, true),
        ),
      );
    const local = active.find((row) => row.movimentoId === movementId)!;
    const external = active.find(
      (row) => row.importazioneAgeaRigaId === importRowId,
    )!;
    const matchPayload = {
      versione: header.versione,
      azione: "ABBINA",
      motivazione: "concorrenza ABBINA R2",
      movimentoId: movementId,
      importazioneAgeaRigaId: importRowId,
    };
    const matches = await Promise.all([
      request(api)
        .patch(`/fse/riconciliazioni/${reconciliationId}/righe/${local.id}`)
        .send(matchPayload),
      request(api)
        .patch(`/fse/riconciliazioni/${reconciliationId}/righe/${external.id}`)
        .send(matchPayload),
    ]);
    expect(matches.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    active = await db
      .select()
      .from(riconciliazioniFseRigheTable)
      .where(
        and(
          eq(riconciliazioniFseRigheTable.riconciliazioneId, reconciliationId),
          eq(riconciliazioniFseRigheTable.active, true),
        ),
      );
    expect(
      active.filter((row) => row.tipoRiga !== "SALDO_PARTITA"),
    ).toHaveLength(1);
    expect(active.find((row) => row.movimentoId === movementId)).toMatchObject({
      importazioneAgeaRigaId: importRowId,
      matchMethod: "ABBINAMENTO_MANUALE_STRUTTURATO",
    });
  });
});
