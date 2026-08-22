import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  FONDI_ORIGINE,
  fornitoriTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  ORIGINI_CARICO,
  prodottiTable,
  systemLogsTable,
  type FondoOrigine,
  type OrigineCarico,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "./inventoryDecimal";

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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function requiredDateOnly(value: string, field: string): string {
  if (!DATE_ONLY.test(value)) {
    throw new InventoryLedgerError(
      400,
      `${field} deve essere una data YYYY-MM-DD`,
    );
  }
  return value;
}

function optionalText(
  value: string | null | undefined,
  max: number,
): string | null {
  const result = value?.trim() ?? "";
  if (result.length > max) {
    throw new InventoryLedgerError(
      400,
      `Testo troppo lungo (massimo ${max} caratteri)`,
    );
  }
  return result || null;
}

export function normalizeInventoryLotCode(value: string | null | undefined): {
  original: string | null;
  normalized: string | null;
} {
  const original = optionalText(value, 80);
  return {
    original,
    normalized:
      original?.replace(/\s+/g, " ").toLocaleUpperCase("it-IT") ?? null,
  };
}

function decimalText(
  value: string | number | null | undefined,
  options: { required?: boolean; maxScale?: number } = {},
): string | null {
  if (value == null || value === "") {
    if (options.required)
      throw new InventoryLedgerError(400, "Valore decimale obbligatorio");
    return null;
  }
  try {
    const parsed = InventoryDecimal.parse(value, {
      maxScale: options.maxScale ?? 6,
    });
    return parsed.toDb();
  } catch (error) {
    if (error instanceof InventoryDecimalError) {
      throw new InventoryLedgerError(400, error.message);
    }
    throw error;
  }
}

function factorText(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim().replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (!match || /^0(?:\.0+)?$/.test(text)) {
    throw new InventoryLedgerError(
      400,
      "Il fattore Kg/Lt per pezzo deve essere positivo e avere al massimo 9 decimali",
    );
  }
  return `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}`;
}

export interface WarehouseLoadLineInput {
  prodottoId: number;
  fondoOrigine: FondoOrigine;
  quantitaOperativa: string | number;
  unitaMisuraOperativa?: string | null;
  quantitaPezzi?: string | number | null;
  quantitaKgLt?: string | number | null;
  fattoreKgLtPezzo?: string | number | null;
  codiceLotto?: string | null;
  dataScadenza?: string | null;
  descrizioneEsterna?: string | null;
  riferimentoEsterno?: string | null;
  note?: string | null;
}

export interface WarehouseLoadInput {
  magazzinoId: number;
  origineCarico: OrigineCarico;
  numeroDocumento?: string | null;
  dataDocumento?: string | null;
  dataCarico: string;
  descrizione?: string | null;
  fornitoreId?: number | null;
  note?: string | null;
  idempotencyKey?: string | null;
  creatoDa: number;
  righe: WarehouseLoadLineInput[];
}

export interface WarehouseLoadResult {
  carico: typeof carichiMagazzinoTable.$inferSelect;
  righe: Array<{
    riga: typeof carichiMagazzinoRigheTable.$inferSelect;
    lotto: typeof lottiTable.$inferSelect;
    prodottoNome?: string | null;
  }>;
  replay: boolean;
}

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

async function existingWarehouseLoad(
  tx: InventoryTransaction,
  carico: typeof carichiMagazzinoTable.$inferSelect,
  replay: boolean,
): Promise<WarehouseLoadResult> {
  const righe = await tx
    .select({ riga: carichiMagazzinoRigheTable, lotto: lottiTable })
    .from(carichiMagazzinoRigheTable)
    .innerJoin(
      lottiTable,
      eq(carichiMagazzinoRigheTable.lottoId, lottiTable.id),
    )
    .where(eq(carichiMagazzinoRigheTable.caricoMagazzinoId, carico.id))
    .orderBy(carichiMagazzinoRigheTable.numeroRiga);
  return { carico, righe, replay };
}

/**
 * Registra una testata di carico e tutte le sue righe nella transazione chiamante.
 * La quantità è trattata come decimale a scala fissa; una partita fisica viene
 * riutilizzata soltanto sulla chiave esplicita magazzino/prodotto/Fondo/lotto.
 */
export async function createWarehouseLoad(
  tx: InventoryTransaction,
  input: WarehouseLoadInput,
): Promise<WarehouseLoadResult> {
  if (!Number.isSafeInteger(input.magazzinoId) || input.magazzinoId <= 0) {
    throw new InventoryLedgerError(400, "Magazzino non valido");
  }
  if (!Number.isSafeInteger(input.creatoDa) || input.creatoDa <= 0) {
    throw new InventoryLedgerError(400, "Operatore non valido");
  }
  if (!ORIGINI_CARICO.includes(input.origineCarico)) {
    throw new InventoryLedgerError(400, "Provenienza del carico non valida");
  }
  if (!Array.isArray(input.righe) || input.righe.length === 0) {
    throw new InventoryLedgerError(400, "Il carico richiede almeno una riga");
  }
  requiredDateOnly(input.dataCarico, "dataCarico");
  if (input.dataDocumento != null)
    requiredDateOnly(input.dataDocumento, "dataDocumento");
  const idempotencyKey = optionalText(input.idempotencyKey, 120);
  if (idempotencyKey) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`carico-idempotency:${idempotencyKey}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(carichiMagazzinoTable)
      .where(eq(carichiMagazzinoTable.idempotencyKey, idempotencyKey));
    if (existing) return existingWarehouseLoad(tx, existing, true);
  }

  const magazzino = await requireOperationalMagazzino(tx, input.magazzinoId);
  const prodottoIds = [...new Set(input.righe.map((riga) => riga.prodottoId))];
  if (prodottoIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new InventoryLedgerError(400, "Prodotto non valido");
  }
  const prodotti = await tx
    .select()
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, prodottoIds));
  if (prodotti.length !== prodottoIds.length) {
    throw new InventoryLedgerError(404, "Uno o più Prodotti non esistono");
  }
  const prodottiMap = new Map(
    prodotti.map((prodotto) => [prodotto.id, prodotto]),
  );
  if (prodotti.some((prodotto) => !prodotto.attivo)) {
    throw new InventoryLedgerError(
      400,
      "Il carico contiene un Prodotto non attivo",
    );
  }

  const fornitoreId = input.fornitoreId ?? null;
  if (fornitoreId != null) {
    const [fornitore] = await tx
      .select()
      .from(fornitoriTable)
      .where(eq(fornitoriTable.id, fornitoreId));
    if (!fornitore)
      throw new InventoryLedgerError(404, "Fornitore non trovato");
    if (!fornitore.attivo)
      throw new InventoryLedgerError(
        400,
        "Il Fornitore selezionato non è attivo",
      );
    if (
      fornitore.areaOperativaId != null &&
      fornitore.areaOperativaId !== magazzino.areaOperativaId
    ) {
      throw new InventoryLedgerError(
        403,
        "Fornitore non accessibile per l'Area del Magazzino",
      );
    }
  }

  const normalizedLines = input.righe.map((riga, index) => {
    const prodotto = prodottiMap.get(riga.prodottoId)!;
    if (!FONDI_ORIGINE.includes(riga.fondoOrigine)) {
      throw new InventoryLedgerError(
        400,
        `Fondo non valido alla riga ${index + 1}`,
      );
    }
    let quantita: InventoryDecimal;
    try {
      quantita = positiveInventoryDecimal(riga.quantitaOperativa);
    } catch (error) {
      if (error instanceof InventoryDecimalError) {
        throw new InventoryLedgerError(
          400,
          `Riga ${index + 1}: ${error.message}`,
        );
      }
      throw error;
    }
    const unita =
      optionalText(riga.unitaMisuraOperativa, 20) ?? prodotto.unitaMisura;
    if (unita !== prodotto.unitaMisura) {
      throw new InventoryLedgerError(
        400,
        `Unità non coerente col Prodotto alla riga ${index + 1}`,
      );
    }
    const lotto = normalizeInventoryLotCode(riga.codiceLotto);
    if (prodotto.gestioneLotto && lotto.original == null) {
      throw new InventoryLedgerError(
        400,
        `Codice lotto obbligatorio alla riga ${index + 1}`,
      );
    }
    const dataScadenza = optionalText(riga.dataScadenza, 10);
    if (dataScadenza != null) requiredDateOnly(dataScadenza, "dataScadenza");
    if (prodotto.gestioneScadenza && dataScadenza == null) {
      throw new InventoryLedgerError(
        400,
        `Data di scadenza obbligatoria alla riga ${index + 1}`,
      );
    }
    const quantitaPezzi = decimalText(
      riga.quantitaPezzi ??
        (prodotto.unitaMisura.toLowerCase() === "pz" ? quantita.toDb() : null),
    );
    const quantitaKgLt = decimalText(
      riga.quantitaKgLt ??
        (["kg", "lt", "l"].includes(prodotto.unitaMisura.toLowerCase())
          ? quantita.toDb()
          : null),
    );
    return {
      numeroRiga: index + 1,
      input: riga,
      prodotto,
      quantita,
      unita,
      lotto,
      dataScadenza,
      quantitaPezzi,
      quantitaKgLt,
      fattore: factorText(riga.fattoreKgLtPezzo),
    };
  });

  const lockKeys = normalizedLines
    .filter((line) => line.lotto.normalized != null)
    .map(
      (line) =>
        `${input.magazzinoId}:${line.prodotto.id}:${line.input.fondoOrigine}:${line.lotto.normalized}`,
    )
    .sort();
  for (const key of [...new Set(lockKeys)]) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }

  const [carico] = await tx
    .insert(carichiMagazzinoTable)
    .values({
      magazzinoId: input.magazzinoId,
      origineCarico: input.origineCarico,
      numeroDocumento: optionalText(input.numeroDocumento, 100),
      dataDocumento: input.dataDocumento ?? null,
      dataCarico: input.dataCarico,
      descrizione: optionalText(input.descrizione, 4000),
      fornitoreId,
      note: optionalText(input.note, 4000),
      idempotencyKey,
      creatoDa: input.creatoDa,
    })
    .returning();

  const createdLines: WarehouseLoadResult["righe"] = [];
  for (const line of normalizedLines) {
    let lotto: typeof lottiTable.$inferSelect | undefined;
    if (line.lotto.normalized != null) {
      [lotto] = await tx
        .select()
        .from(lottiTable)
        .where(
          and(
            eq(lottiTable.magazzinoId, input.magazzinoId),
            eq(lottiTable.prodottoId, line.prodotto.id),
            eq(lottiTable.fondoOrigine, line.input.fondoOrigine),
            eq(lottiTable.codiceLottoNormalizzato, line.lotto.normalized),
          ),
        )
        .for("update");
    }
    if (lotto) {
      if ((lotto.dataScadenza ?? null) !== line.dataScadenza) {
        throw new InventoryLedgerError(
          409,
          `Scadenza incompatibile per la partita ${line.lotto.original}`,
        );
      }
      if (
        lotto.fattoreKgLtPezzo != null &&
        line.fattore != null &&
        lotto.fattoreKgLtPezzo !== line.fattore
      ) {
        throw new InventoryLedgerError(
          409,
          `Fattore Pezzi/KgLt incompatibile per la partita ${line.lotto.original}`,
        );
      }
      const caricata = InventoryDecimal.parse(lotto.quantitaCaricata).add(
        line.quantita,
      );
      const residua = InventoryDecimal.parse(lotto.quantitaResidua).add(
        line.quantita,
      );
      [lotto] = await tx
        .update(lottiTable)
        .set({
          quantitaCaricata: caricata.toDb(),
          quantitaResidua: residua.toDb(),
          dataCarico:
            input.dataCarico < lotto.dataCarico
              ? input.dataCarico
              : lotto.dataCarico,
          dataUltimoCarico:
            input.dataCarico > (lotto.dataUltimoCarico ?? lotto.dataCarico)
              ? input.dataCarico
              : (lotto.dataUltimoCarico ?? lotto.dataCarico),
          fattoreKgLtPezzo: lotto.fattoreKgLtPezzo ?? line.fattore,
        })
        .where(eq(lottiTable.id, lotto.id))
        .returning();
    } else {
      [lotto] = await tx
        .insert(lottiTable)
        .values({
          prodottoId: line.prodotto.id,
          codiceLotto: line.lotto.original,
          codiceLottoNormalizzato: line.lotto.normalized,
          dataScadenza: line.dataScadenza,
          dataCarico: input.dataCarico,
          dataUltimoCarico: input.dataCarico,
          quantitaCaricata: line.quantita.toDb(),
          quantitaResidua: line.quantita.toDb(),
          magazzinoId: input.magazzinoId,
          fornitoreId,
          fsePlus: line.input.fondoOrigine === "FSE_PLUS",
          fondoOrigine: line.input.fondoOrigine,
          fattoreKgLtPezzo: line.fattore,
          documentoCarico: optionalText(input.numeroDocumento, 100),
          note: optionalText(line.input.note ?? input.note, 4000),
        })
        .returning();
    }

    const [riga] = await tx
      .insert(carichiMagazzinoRigheTable)
      .values({
        caricoMagazzinoId: carico.id,
        numeroRiga: line.numeroRiga,
        prodottoId: line.prodotto.id,
        lottoId: lotto.id,
        fondoOrigine: line.input.fondoOrigine,
        quantitaOperativa: line.quantita.toDb(),
        unitaMisuraOperativa: line.unita,
        quantitaPezzi: line.quantitaPezzi,
        quantitaKgLt: line.quantitaKgLt,
        fattoreKgLtPezzo: line.fattore,
        codiceLottoOriginale: line.lotto.original,
        dataScadenza: line.dataScadenza,
        descrizioneEsterna: optionalText(line.input.descrizioneEsterna, 4000),
        riferimentoEsterno: optionalText(line.input.riferimentoEsterno, 160),
        note: optionalText(line.input.note, 4000),
      })
      .returning();

    await tx.insert(movimentiTable).values({
      tipoMovimento: "carico",
      tipoDettaglio: input.origineCarico.toLowerCase(),
      dataMovimento: input.dataCarico,
      magazzinoId: input.magazzinoId,
      prodottoId: line.prodotto.id,
      lottoId: lotto.id,
      quantita: line.quantita.toDb(),
      quantitaPezzi: line.quantitaPezzi,
      quantitaKgLt: line.quantitaKgLt,
      unitaMisura: line.unita,
      fornitoreId,
      fondoOrigine: line.input.fondoOrigine,
      naturaContabile:
        input.origineCarico === "SALDO_INIZIALE" ? "SALDO_INIZIALE" : "CARICO",
      dominioOrigine: "MAGAZZINO",
      entitaOrigineTipo: "carico_magazzino",
      entitaOrigineId: carico.id,
      rigaOrigineId: riga.id,
      caricoMagazzinoRigaId: riga.id,
      operatoreId: input.creatoDa,
      documentoRiferimento: optionalText(input.numeroDocumento, 100),
      note: optionalText(line.input.note ?? input.note, 4000),
    });
    createdLines.push({ riga, lotto });
  }

  await tx.insert(systemLogsTable).values({
    evento: "MAGAZZINO_CARICO_CONFERMATO",
    esito: "SUCCESS",
    actorUserId: input.creatoDa,
    details: {
      caricoId: carico.id,
      magazzinoId: input.magazzinoId,
      origineCarico: input.origineCarico,
      numeroDocumento: carico.numeroDocumento,
      righe: createdLines.length,
      partite: createdLines.map((line) => line.lotto.id),
    },
  });
  return { carico, righe: createdLines, replay: false };
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
  const result = await createWarehouseLoad(tx, {
    magazzinoId: input.magazzinoId,
    origineCarico:
      input.causale === "acquisto"
        ? "ACQUISTO"
        : input.causale === "donazione"
          ? "DONAZIONE"
          : "AGEA_SIFEAD",
    numeroDocumento: input.documentoCarico,
    dataCarico: input.dataCarico,
    fornitoreId: input.fornitoreId,
    note: input.note,
    creatoDa: input.operatoreId,
    righe: [
      {
        prodottoId: input.prodottoId,
        fondoOrigine: input.fsePlus ? "FSE_PLUS" : "NESSUN_FONDO",
        quantitaOperativa: input.quantita,
        codiceLotto: input.codiceLotto,
        dataScadenza: input.dataScadenza,
        note: input.note,
      },
    ],
  });
  return result.righe[0].lotto;
}

export interface RettificaInventarialeInput {
  lottoId: number;
  delta: string | number;
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
  let delta: InventoryDecimal;
  try {
    delta = InventoryDecimal.parse(input.delta, { allowNegative: true });
  } catch (error) {
    if (error instanceof InventoryDecimalError)
      throw new InventoryLedgerError(400, error.message);
    throw error;
  }
  if (delta.isZero())
    throw new InventoryLedgerError(
      400,
      "Il delta di rettifica deve essere diverso da zero",
    );
  if (!RETTIFICA_CAUSALI.includes(input.causale)) {
    throw new InventoryLedgerError(400, "Causale di rettifica non valida");
  }
  const motivazione = input.motivazione?.trim() ?? "";
  if (input.causale === "altro" && !motivazione) {
    throw new InventoryLedgerError(
      400,
      "La causale Altro richiede una motivazione",
    );
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

  const nuovaQuantita = InventoryDecimal.parse(lotto.lotto.quantitaResidua).add(
    delta,
  );
  if (nuovaQuantita.isNegative()) {
    throw new InventoryLedgerError(
      409,
      "La rettifica porterebbe la giacenza sotto zero",
    );
  }

  const [aggiornato] = await tx
    .update(lottiTable)
    .set({ quantitaResidua: nuovaQuantita.toDb() })
    .where(eq(lottiTable.id, lotto.lotto.id))
    .returning();
  await tx.insert(movimentiTable).values({
    tipoMovimento: delta.isPositive()
      ? "rettifica_positiva"
      : "rettifica_negativa",
    tipoDettaglio: input.causale,
    dataMovimento: input.dataMovimento,
    magazzinoId: lotto.lotto.magazzinoId,
    prodottoId: lotto.lotto.prodottoId,
    lottoId: lotto.lotto.id,
    quantita: delta.abs().toDb(),
    unitaMisura: lotto.unitaMisura,
    fornitoreId: lotto.lotto.fornitoreId,
    fondoOrigine: lotto.lotto.fondoOrigine,
    naturaContabile: delta.isPositive()
      ? "RETTIFICA_POSITIVA"
      : "RETTIFICA_NEGATIVA",
    dominioOrigine: "MAGAZZINO",
    entitaOrigineTipo: "lotto",
    entitaOrigineId: lotto.lotto.id,
    operatoreId: input.operatoreId,
    documentoRiferimento: lotto.lotto.documentoCarico,
    note: [motivazione, input.note?.trim()].filter(Boolean).join(" — ") || null,
  });
  return aggiornato;
}
