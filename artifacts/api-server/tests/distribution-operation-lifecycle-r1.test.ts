/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prodottiTable,
  scarichiTable,
  scaricoRigheTable,
  utentiTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ensureDistributionOperation,
  reconcileDistributionOperationState,
} from "../src/lib/distributionLedger";
import {
  creaScaricoInventariale,
  stornaScaricoInventariale,
} from "../src/lib/scaricoInventory";
import { InventoryDecimal } from "../src/lib/inventoryDecimal";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let operatoreId: number;
let magazzinoId: number;
let prodottoId: number;
let lottoId: number;
let r2ScaricoId: number | null = null;

beforeAll(async () => {
  [{ id: operatoreId }] = await db
    .insert(utentiTable)
    .values({
      username: `distribution_r1_${suffix}`,
      passwordHash: "x",
      nome: "Distribution",
      cognome: "R1",
    })
    .returning({ id: utentiTable.id });
  [{ id: magazzinoId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `DR1-${suffix}`.slice(0, 20),
      nome: `Distribution ${suffix}`,
    })
    .returning({ id: magazziniTable.id });
  [{ id: prodottoId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `DR1P-${suffix}`.slice(0, 30),
      nome: "Prodotto distribution R1",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
    })
    .returning({ id: prodottiTable.id });
  [{ id: lottoId }] = await db
    .insert(lottiTable)
    .values({
      prodottoId,
      magazzinoId,
      dataCarico: "2026-08-01",
      quantitaCaricata: "20.000000",
      quantitaResidua: "20.000000",
      fondoOrigine: "NESSUN_FONDO",
    })
    .returning({ id: lottiTable.id });
});

afterAll(async () => {
  await db
    .delete(movimentiTable)
    .where(eq(movimentiTable.magazzinoId, magazzinoId));
  await db
    .delete(operazioniDistribuzioneMagazzinoTable)
    .where(eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId));
  if (r2ScaricoId != null) {
    await db
      .delete(scaricoRigheTable)
      .where(eq(scaricoRigheTable.scaricoId, r2ScaricoId));
    await db.delete(scarichiTable).where(eq(scarichiTable.id, r2ScaricoId));
  }
  await db.delete(lottiTable).where(eq(lottiTable.id, lottoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, magazzinoId));
  await db.delete(utentiTable).where(eq(utentiTable.id, operatoreId));
  await pool.end();
});

async function ensure(sourceId: number, numeroPasti?: number) {
  return db.transaction((tx) =>
    ensureDistributionOperation(tx, {
      magazzinoId,
      dataDistribuzione: "2026-08-30",
      canaleOperativo: "MENSA",
      dominioOrigine: "MENSA",
      entitaOrigineTipo: "mensa_giornata_servizio",
      entitaOrigineId: sourceId,
      numeroPasti,
      creatoDa: operatoreId,
    }),
  );
}

describe("Magazzino 2.0A-R1 — lifecycle operazione distribuzione", () => {
  it("serializza la stessa sorgente e aggiorna le statistiche autorevoli", async () => {
    const sourceId = 9_000_000 + Math.floor(Math.random() * 100_000);
    const concurrent = await Promise.all([
      ensure(sourceId, 1),
      ensure(sourceId, 1),
      ensure(sourceId, 1),
    ]);
    expect(new Set(concurrent.map((row) => row.id)).size).toBe(1);
    const updated = await ensure(sourceId, 7);
    expect(updated.numeroPasti).toBe(7);
  });

  it("passa da confermata a parzialmente_stornata e poi stornata", async () => {
    const sourceId = 9_100_000 + Math.floor(Math.random() * 100_000);
    const operation = await ensure(sourceId, 2);
    const originals = await db
      .insert(movimentiTable)
      .values([
        {
          tipoMovimento: "scarico",
          tipoDettaglio: "test_r1",
          dataMovimento: "2026-08-30",
          magazzinoId,
          prodottoId,
          quantita: "10",
          quantitaPezzi: "10",
          unitaMisura: "pz",
          naturaContabile: "DISTRIBUZIONE_FINALE",
          fondoOrigine: "NESSUN_FONDO",
          operazioneDistribuzioneId: operation.id,
        },
        {
          tipoMovimento: "scarico",
          tipoDettaglio: "test_r1",
          dataMovimento: "2026-08-30",
          magazzinoId,
          prodottoId,
          quantita: "5",
          quantitaPezzi: "5",
          unitaMisura: "pz",
          naturaContabile: "DISTRIBUZIONE_FINALE",
          fondoOrigine: "NESSUN_FONDO",
          operazioneDistribuzioneId: operation.id,
        },
      ])
      .returning({ id: movimentiTable.id });
    expect((await ensure(sourceId, 2)).id).toBe(operation.id);
    await expect(ensure(sourceId, 3)).rejects.toThrow(
      /OPERAZIONE_DISTRIBUZIONE_IMMUTABILE/,
    );
    await db.insert(movimentiTable).values({
      tipoMovimento: "storno",
      tipoDettaglio: "test_r1",
      dataMovimento: "2026-08-30",
      magazzinoId,
      prodottoId,
      quantita: "4",
      quantitaPezzi: "4",
      unitaMisura: "pz",
      naturaContabile: "STORNO",
      fondoOrigine: "NESSUN_FONDO",
      movimentoOrigineId: originals[0].id,
      operazioneDistribuzioneId: operation.id,
    });
    await db.transaction((tx) =>
      reconcileDistributionOperationState(tx, operation.id),
    );
    let [state] = await db
      .select({ stato: operazioniDistribuzioneMagazzinoTable.stato })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, operation.id));
    expect(state.stato).toBe("parzialmente_stornata");

    await db.insert(movimentiTable).values({
      tipoMovimento: "storno",
      tipoDettaglio: "test_r1",
      dataMovimento: "2026-08-30",
      magazzinoId,
      prodottoId,
      quantita: "6",
      quantitaPezzi: "6",
      unitaMisura: "pz",
      naturaContabile: "STORNO",
      fondoOrigine: "NESSUN_FONDO",
      movimentoOrigineId: originals[0].id,
      operazioneDistribuzioneId: operation.id,
    });
    await db.transaction((tx) =>
      reconcileDistributionOperationState(tx, operation.id),
    );
    [state] = await db
      .select({ stato: operazioniDistribuzioneMagazzinoTable.stato })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, operation.id));
    expect(state.stato).toBe("parzialmente_stornata");

    await db.insert(movimentiTable).values({
      tipoMovimento: "storno",
      tipoDettaglio: "test_r1",
      dataMovimento: "2026-08-30",
      magazzinoId,
      prodottoId,
      quantita: "5",
      quantitaPezzi: "5",
      unitaMisura: "pz",
      naturaContabile: "STORNO",
      fondoOrigine: "NESSUN_FONDO",
      movimentoOrigineId: originals[1].id,
      operazioneDistribuzioneId: operation.id,
    });
    await db.transaction((tx) =>
      reconcileDistributionOperationState(tx, operation.id),
    );
    [state] = await db
      .select({ stato: operazioniDistribuzioneMagazzinoTable.stato })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, operation.id));
    expect(state.stato).toBe("stornata");

    await db.insert(movimentiTable).values({
      tipoMovimento: "storno",
      tipoDettaglio: "test_r1",
      dataMovimento: "2026-08-30",
      magazzinoId,
      prodottoId,
      quantita: "0.000001",
      quantitaPezzi: "0.000001",
      unitaMisura: "pz",
      naturaContabile: "STORNO",
      fondoOrigine: "NESSUN_FONDO",
      movimentoOrigineId: originals[1].id,
      operazioneDistribuzioneId: operation.id,
    });
    await expect(
      db.transaction((tx) =>
        reconcileDistributionOperationState(tx, operation.id),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("Magazzino 2.0A-R2 — lifecycle dopo nuovi movimenti", () => {
  it("riconcilia stornata → nuovo movimento → parzialmente_stornata → stornata", async () => {
    const sourceId = 9_200_000 + Math.floor(Math.random() * 100_000);
    const operation = await ensure(sourceId, 2);
    const [originalA] = await db
      .insert(movimentiTable)
      .values({
        tipoMovimento: "scarico",
        tipoDettaglio: "test_r2_a",
        dataMovimento: "2026-08-30",
        magazzinoId,
        prodottoId,
        quantita: "2.000000",
        quantitaPezzi: "2.000000",
        unitaMisura: "pz",
        naturaContabile: "DISTRIBUZIONE_FINALE",
        fondoOrigine: "NESSUN_FONDO",
        operazioneDistribuzioneId: operation.id,
      })
      .returning({ id: movimentiTable.id });
    await db.insert(movimentiTable).values({
      tipoMovimento: "storno",
      tipoDettaglio: "test_r2_a",
      dataMovimento: "2026-08-30",
      magazzinoId,
      prodottoId,
      quantita: "2.000000",
      quantitaPezzi: "2.000000",
      unitaMisura: "pz",
      naturaContabile: "STORNO",
      fondoOrigine: "NESSUN_FONDO",
      movimentoOrigineId: originalA.id,
      operazioneDistribuzioneId: operation.id,
    });
    await db.transaction((tx) =>
      reconcileDistributionOperationState(tx, operation.id),
    );
    let [state] = await db
      .select({ stato: operazioniDistribuzioneMagazzinoTable.stato })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, operation.id));
    expect(state.stato).toBe("stornata");

    const documentReference = `R2-${suffix}`;
    r2ScaricoId = await db.transaction((tx) =>
      creaScaricoInventariale(tx, {
        codice: documentReference,
        magazzinoId,
        centroAscoltoId: null,
        dataScarico: "2026-08-30",
        causale: "altro",
        causaleAltro: "Test lifecycle R2",
        operatoreId,
        documentoRiferimento: documentReference,
        source: {
          naturaContabile: "DISTRIBUZIONE_FINALE",
          dominioOrigine: "MENSA",
          entitaOrigineTipo: "mensa_giornata_servizio",
          entitaOrigineId: sourceId,
          canaleOperativo: "MENSA",
          operazioneDistribuzioneId: operation.id,
        },
        righe: [
          {
            prodottoId,
            quantita: "3.000000",
            unitaMisura: "pz",
          },
        ],
      }),
    );

    [state] = await db
      .select({ stato: operazioniDistribuzioneMagazzinoTable.stato })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, operation.id));
    expect(state.stato).toBe("parzialmente_stornata");
    const afterB = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.operazioneDistribuzioneId, operation.id))
      .orderBy(movimentiTable.id);
    expect(afterB).toHaveLength(3);
    expect(afterB.some((movement) => movement.id === originalA.id)).toBe(true);
    const originalB = afterB.find(
      (movement) =>
        movement.naturaContabile === "DISTRIBUZIONE_FINALE" &&
        movement.id !== originalA.id,
    );
    expect(originalB).toBeDefined();
    expect(
      afterB.some((movement) => movement.movimentoOrigineId === originalA.id),
    ).toBe(true);
    const netAfterB = afterB.reduce((net, movement) => {
      const quantity = InventoryDecimal.parse(movement.quantita);
      return movement.naturaContabile === "STORNO"
        ? net.subtract(quantity)
        : net.add(quantity);
    }, InventoryDecimal.zero());
    expect(netAfterB.toDb()).toBe("3.000000");

    await db.transaction((tx) =>
      stornaScaricoInventariale(tx, {
        documentoRiferimento: documentReference,
        dataMovimento: "2026-08-30",
        operatoreId,
        tipoDettaglio: "test_r2_b",
        note: "Storno movimento B",
      }),
    );
    [state] = await db
      .select({ stato: operazioniDistribuzioneMagazzinoTable.stato })
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(eq(operazioniDistribuzioneMagazzinoTable.id, operation.id));
    expect(state.stato).toBe("stornata");
    const finalLedger = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.operazioneDistribuzioneId, operation.id));
    expect(finalLedger).toHaveLength(4);
    expect(
      finalLedger
        .filter((movement) => movement.naturaContabile === "STORNO")
        .map((movement) => movement.movimentoOrigineId)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([originalA.id, originalB!.id].sort((a, b) => a - b));
  });
});
