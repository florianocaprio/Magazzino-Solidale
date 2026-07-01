import { db, lottiTable, prenotazioniMagazzinoTable } from "@workspace/db";
import { and, eq, inArray, sum } from "drizzle-orm";

export const PRENOTAZIONE_MAGAZZINO_ATTIVA = "attiva";

export type DisponibilitaMagazzino = {
  prodottoId: number;
  magazzinoId: number;
  giacenzaFisica: number;
  impegnato: number;
  disponibileReale: number;
};

export function disponibilitaMagazzinoKey(prodottoId: number, magazzinoId: number): string {
  return `${prodottoId}:${magazzinoId}`;
}

export function parseDbNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function calcolaDisponibilitaMagazzino(
  prodottoId: number,
  magazzinoId: number,
): Promise<DisponibilitaMagazzino> {
  const [fisico] = await db
    .select({ totale: sum(lottiTable.quantitaResidua) })
    .from(lottiTable)
    .where(and(eq(lottiTable.prodottoId, prodottoId), eq(lottiTable.magazzinoId, magazzinoId)));

  const [prenotato] = await db
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.prodottoId, prodottoId),
        eq(prenotazioniMagazzinoTable.magazzinoId, magazzinoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
      ),
    );

  const giacenzaFisica = parseDbNumber(fisico?.totale);
  const impegnato = parseDbNumber(prenotato?.totale);
  return {
    prodottoId,
    magazzinoId,
    giacenzaFisica,
    impegnato,
    disponibileReale: giacenzaFisica - impegnato,
  };
}

export async function calcolaImpegnatoAttivoPerGiacenze(
  pairs: Array<{ prodottoId: number; magazzinoId: number }>,
): Promise<Map<string, number>> {
  if (pairs.length === 0) return new Map();

  const prodottoIds = [...new Set(pairs.map((pair) => pair.prodottoId))];
  const magazzinoIds = [...new Set(pairs.map((pair) => pair.magazzinoId))];
  const requestedKeys = new Set(pairs.map((pair) => disponibilitaMagazzinoKey(pair.prodottoId, pair.magazzinoId)));

  const rows = await db
    .select({
      prodottoId: prenotazioniMagazzinoTable.prodottoId,
      magazzinoId: prenotazioniMagazzinoTable.magazzinoId,
      totale: sum(prenotazioniMagazzinoTable.quantita),
    })
    .from(prenotazioniMagazzinoTable)
    .where(
      and(
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
        inArray(prenotazioniMagazzinoTable.prodottoId, prodottoIds),
        inArray(prenotazioniMagazzinoTable.magazzinoId, magazzinoIds),
      ),
    )
    .groupBy(prenotazioniMagazzinoTable.prodottoId, prenotazioniMagazzinoTable.magazzinoId);

  const result = new Map<string, number>();
  for (const row of rows) {
    const key = disponibilitaMagazzinoKey(row.prodottoId, row.magazzinoId);
    if (requestedKeys.has(key)) {
      result.set(key, parseDbNumber(row.totale));
    }
  }
  return result;
}
