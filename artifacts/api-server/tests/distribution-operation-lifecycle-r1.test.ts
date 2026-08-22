/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prodottiTable,
  utentiTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ensureDistributionOperation,
  reconcileDistributionOperationState,
} from "../src/lib/distributionLedger";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let operatoreId: number;
let magazzinoId: number;
let prodottoId: number;

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
    .values({ codice: `DR1-${suffix}`.slice(0, 20), nome: `Distribution ${suffix}` })
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
});

afterAll(async () => {
  await db.delete(movimentiTable).where(eq(movimentiTable.magazzinoId, magazzinoId));
  await db
    .delete(operazioniDistribuzioneMagazzinoTable)
    .where(eq(operazioniDistribuzioneMagazzinoTable.magazzinoId, magazzinoId));
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
    const operation = await ensure(
      9_100_000 + Math.floor(Math.random() * 100_000),
      2,
    );
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
