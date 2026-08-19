import {
  fornitoriTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  prodottiTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";
import { parseDbNumber } from "./disponibilitaMagazzino";

export class InventoryLedgerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const RETTIFICA_CAUSALI = [
  "inventario_fisico",
  "errore_registrazione",
  "deterioramento",
  "altro",
] as const;

export type RettificaCausale = (typeof RETTIFICA_CAUSALI)[number];

export async function requireOperationalMagazzino(
  tx: InventoryTransaction,
  magazzinoId: number,
) {
  const [magazzino] = await tx
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, magazzinoId));
  if (!magazzino) {
    throw new InventoryLedgerError(404, "Magazzino non trovato");
  }
  if (magazzino.stato !== "attivo") {
    throw new InventoryLedgerError(
      400,
      "Il Magazzino selezionato non è attivo e non può essere usato per nuove operazioni",
    );
  }
  return magazzino;
}

export interface CaricoInventarialeInput {
  prodottoId: number;
  codiceLotto?: string | null;
  dataScadenza?: string | null;
  dataCarico: string;
  quantita: number;
  magazzinoId: number;
  fornitoreId?: number | null;
  fsePlus: boolean;
  documentoCarico?: string | null;
  causale: "acquisto" | "donazione" | "fse_plus";
  note?: string | null;
  operatoreId: number;
}

/** Crea la giacenza iniziale e il relativo evento contabile in modo atomico. */
export async function creaCaricoInventariale(
  tx: InventoryTransaction,
  input: CaricoInventarialeInput,
) {
  if (!Number.isFinite(input.quantita) || input.quantita <= 0) {
    throw new InventoryLedgerError(400, "La quantità caricata deve essere maggiore di zero");
  }
  await requireOperationalMagazzino(tx, input.magazzinoId);

  const [prodotto] = await tx
    .select()
    .from(prodottiTable)
    .where(eq(prodottiTable.id, input.prodottoId));
  if (!prodotto) throw new InventoryLedgerError(404, "Prodotto non trovato");
  if (!prodotto.attivo) {
    throw new InventoryLedgerError(400, "Il Prodotto selezionato non è attivo");
  }

  if (input.fsePlus && input.fornitoreId != null) {
    throw new InventoryLedgerError(400, "Un lotto FSE+ non può avere anche un Fornitore");
  }
  if (!input.fsePlus && input.fornitoreId == null) {
    throw new InventoryLedgerError(400, "Specificare la provenienza: FSE+ oppure un Fornitore");
  }
  if (input.fornitoreId != null) {
    const [fornitore] = await tx
      .select({ attivo: fornitoriTable.attivo })
      .from(fornitoriTable)
      .where(eq(fornitoriTable.id, input.fornitoreId));
    if (!fornitore) throw new InventoryLedgerError(404, "Fornitore non trovato");
    if (!fornitore.attivo) {
      throw new InventoryLedgerError(400, "Il Fornitore selezionato non è attivo");
    }
  }

  const quantita = input.quantita.toFixed(2);
  const [lotto] = await tx
    .insert(lottiTable)
    .values({
      prodottoId: input.prodottoId,
      codiceLotto: input.codiceLotto ?? null,
      dataScadenza: input.dataScadenza ?? null,
      dataCarico: input.dataCarico,
      quantitaCaricata: quantita,
      quantitaResidua: quantita,
      magazzinoId: input.magazzinoId,
      fornitoreId: input.fornitoreId ?? null,
      fsePlus: input.fsePlus,
      documentoCarico: input.documentoCarico ?? null,
      note: input.note ?? null,
    })
    .returning();

  await tx.insert(movimentiTable).values({
    tipoMovimento: "carico",
    tipoDettaglio: input.causale,
    dataMovimento: input.dataCarico,
    magazzinoId: input.magazzinoId,
    prodottoId: input.prodottoId,
    lottoId: lotto.id,
    quantita,
    unitaMisura: prodotto.unitaMisura,
    fornitoreId: input.fornitoreId ?? null,
    operatoreId: input.operatoreId,
    documentoRiferimento: input.documentoCarico ?? null,
    note: input.note ?? null,
  });
  return lotto;
}

export interface RettificaInventarialeInput {
  lottoId: number;
  delta: number;
  causale: RettificaCausale;
  motivazione?: string | null;
  note?: string | null;
  dataMovimento: string;
  operatoreId: number;
}

/** Rettifica la giacenza con lock pessimista e registra sempre un nuovo evento. */
export async function rettificaInventariale(
  tx: InventoryTransaction,
  input: RettificaInventarialeInput,
) {
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new InventoryLedgerError(400, "Il delta di rettifica deve essere diverso da zero");
  }
  if (!RETTIFICA_CAUSALI.includes(input.causale)) {
    throw new InventoryLedgerError(400, "Causale di rettifica non valida");
  }
  const motivazione = input.motivazione?.trim() ?? "";
  if (input.causale === "altro" && !motivazione) {
    throw new InventoryLedgerError(400, "La causale Altro richiede una motivazione");
  }

  await tx.execute(
    sql`SELECT id FROM ${lottiTable} WHERE ${lottiTable.id} = ${input.lottoId} FOR UPDATE`,
  );
  const [lotto] = await tx
    .select({ lotto: lottiTable, unitaMisura: prodottiTable.unitaMisura })
    .from(lottiTable)
    .innerJoin(prodottiTable, eq(lottiTable.prodottoId, prodottiTable.id))
    .where(eq(lottiTable.id, input.lottoId));
  if (!lotto) throw new InventoryLedgerError(404, "Lotto non trovato");
  await requireOperationalMagazzino(tx, lotto.lotto.magazzinoId);

  const nuovaQuantita = parseDbNumber(lotto.lotto.quantitaResidua) + input.delta;
  if (nuovaQuantita < 0) {
    throw new InventoryLedgerError(409, "La rettifica porterebbe la giacenza sotto zero");
  }

  const [aggiornato] = await tx
    .update(lottiTable)
    .set({ quantitaResidua: nuovaQuantita.toFixed(2) })
    .where(eq(lottiTable.id, lotto.lotto.id))
    .returning();
  await tx.insert(movimentiTable).values({
    tipoMovimento: input.delta > 0 ? "rettifica_positiva" : "rettifica_negativa",
    tipoDettaglio: input.causale,
    dataMovimento: input.dataMovimento,
    magazzinoId: lotto.lotto.magazzinoId,
    prodottoId: lotto.lotto.prodottoId,
    lottoId: lotto.lotto.id,
    quantita: Math.abs(input.delta).toFixed(2),
    unitaMisura: lotto.unitaMisura,
    fornitoreId: lotto.lotto.fornitoreId,
    operatoreId: input.operatoreId,
    documentoRiferimento: lotto.lotto.documentoCarico,
    note: [motivazione, input.note?.trim()].filter(Boolean).join(" — ") || null,
  });
  return aggiornato;
}
