import {
  db,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  scarichiTable,
  scaricoRigheTable,
} from "@workspace/db";
import { and, asc, eq, gt, sum } from "drizzle-orm";
import {
  PRENOTAZIONE_MAGAZZINO_ATTIVA,
  parseDbNumber,
} from "./disponibilitaMagazzino";

export type InventoryTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export class InventoryError extends Error {}

export interface ScaricoInventarialeRiga {
  prodottoId: number;
  quantita: number;
  unitaMisura: string;
  note?: string | null;
}

interface ScaricoInventarialeInput {
  codice: string;
  magazzinoId: number;
  centroAscoltoId: number | null;
  dataScarico: string;
  causale: string;
  causaleAltro?: string | null;
  note?: string | null;
  operatoreId: number;
  beneficiarioId?: number | null;
  documentoRiferimento?: string | null;
  righe: ScaricoInventarialeRiga[];
}

async function impegnatoAttivoLotto(
  tx: InventoryTransaction,
  lottoId: number,
): Promise<number> {
  const [result] = await tx
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.lottoId, lottoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
      ),
    );
  return parseDbNumber(result?.totale);
}

async function scaricaRigaFefo(
  tx: InventoryTransaction,
  input: ScaricoInventarialeInput,
  riga: ScaricoInventarialeRiga,
): Promise<void> {
  let rimanente = riga.quantita;
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, riga.prodottoId),
        eq(lottiTable.magazzinoId, input.magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
      ),
    )
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico))
    .for("update");

  for (const lotto of lotti) {
    if (rimanente <= 0) break;
    const residua = parseDbNumber(lotto.quantitaResidua);
    const disponibile = Math.max(
      0,
      residua - (await impegnatoAttivoLotto(tx, lotto.id)),
    );
    const prelievo = Math.min(disponibile, rimanente);
    if (prelievo <= 0) continue;

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: (residua - prelievo).toFixed(2) })
      .where(eq(lottiTable.id, lotto.id));
    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: input.causale,
      dataMovimento: input.dataScarico,
      magazzinoId: input.magazzinoId,
      prodottoId: riga.prodottoId,
      lottoId: lotto.id,
      quantita: prelievo.toFixed(2),
      unitaMisura: riga.unitaMisura,
      beneficiarioId: input.beneficiarioId ?? null,
      documentoRiferimento: input.documentoRiferimento ?? null,
      note: `Scarico ${input.codice}${riga.note ? ` — ${riga.note}` : ""}`,
    });
    rimanente = Math.round((rimanente - prelievo) * 100) / 100;
  }

  if (rimanente > 0) {
    throw new InventoryError(
      `Disponibilità insufficiente per il prodotto #${riga.prodottoId}: mancano ${rimanente}`,
    );
  }
}

/**
 * Registra uno scarico e i relativi movimenti FEFO nello stesso contesto
 * transazionale del chiamante. Nessuna giacenza viene modificata se una delle
 * righe fallisce.
 */
export async function creaScaricoInventariale(
  tx: InventoryTransaction,
  input: ScaricoInventarialeInput,
): Promise<number> {
  if (input.righe.length === 0) {
    throw new InventoryError("Lo scarico richiede almeno una riga");
  }
  const [scarico] = await tx
    .insert(scarichiTable)
    .values({
      codice: input.codice,
      magazzinoId: input.magazzinoId,
      centroAscoltoId: input.centroAscoltoId,
      dataScarico: input.dataScarico,
      causale: input.causale,
      causaleAltro: input.causaleAltro ?? null,
      note: input.note ?? null,
      operatoreId: input.operatoreId,
    })
    .returning({ id: scarichiTable.id });

  await tx.insert(scaricoRigheTable).values(
    input.righe.map((riga) => ({
      scaricoId: scarico.id,
      prodottoId: riga.prodottoId,
      quantita: riga.quantita.toFixed(2),
      unitaMisura: riga.unitaMisura,
      note: riga.note ?? null,
    })),
  );
  for (const riga of input.righe) {
    await scaricaRigaFefo(tx, input, riga);
  }
  return scarico.id;
}
