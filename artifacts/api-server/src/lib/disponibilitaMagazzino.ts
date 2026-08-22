import { db, lottiTable, prenotazioniMagazzinoTable } from "@workspace/db";
import { and, eq, inArray, sql, sum } from "drizzle-orm";
import {
  dataOperativaEuropeRome,
  lottoDistribuibileCondition,
} from "./lottoPolicy";
import { InventoryDecimal } from "./inventoryDecimal";

export const PRENOTAZIONE_MAGAZZINO_ATTIVA = "attiva";

export type DisponibilitaMagazzino = {
  prodottoId: number;
  magazzinoId: number;
  giacenzaFisica: number;
  giacenzaScaduta: number;
  giacenzaDistribuibile: number;
  impegnato: number;
  disponibileReale: number;
  giacenzaFisicaPrecisa: string;
  giacenzaScadutaPrecisa: string;
  giacenzaDistribuibilePrecisa: string;
  impegnatoPreciso: string;
  disponibileRealePrecisa: string;
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
  dataOperativa = dataOperativaEuropeRome(),
): Promise<DisponibilitaMagazzino> {
  const [giacenze] = await db
    .select({
      fisica: sum(lottiTable.quantitaResidua),
      scaduta: sql<string>`coalesce(sum(${lottiTable.quantitaResidua}) filter (where ${lottiTable.dataScadenza} < ${dataOperativa}), 0)`,
      distribuibile: sql<string>`coalesce(sum(${lottiTable.quantitaResidua}) filter (where ${lottiTable.dataScadenza} is null or ${lottiTable.dataScadenza} >= ${dataOperativa}), 0)`,
    })
    .from(lottiTable)
    .where(and(eq(lottiTable.prodottoId, prodottoId), eq(lottiTable.magazzinoId, magazzinoId)));

  const [prenotato] = await db
    .select({ totale: sum(prenotazioniMagazzinoTable.quantita) })
    .from(prenotazioniMagazzinoTable)
    .innerJoin(
      lottiTable,
      eq(prenotazioniMagazzinoTable.lottoId, lottiTable.id),
    )
    .where(
      and(
        eq(prenotazioniMagazzinoTable.prodottoId, prodottoId),
        eq(prenotazioniMagazzinoTable.magazzinoId, magazzinoId),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
        lottoDistribuibileCondition(dataOperativa),
      ),
    );

  const giacenzaFisicaPrecisa = InventoryDecimal.parse(
    giacenze?.fisica ?? "0",
  );
  const giacenzaScadutaPrecisa = InventoryDecimal.parse(
    giacenze?.scaduta ?? "0",
  );
  const giacenzaDistribuibilePrecisa = InventoryDecimal.parse(
    giacenze?.distribuibile ?? "0",
  );
  const impegnatoPreciso = InventoryDecimal.parse(prenotato?.totale ?? "0");
  const disponibileRealePreciso = giacenzaDistribuibilePrecisa.subtract(
    impegnatoPreciso,
  );
  const giacenzaFisica = parseDbNumber(giacenzaFisicaPrecisa.toDb());
  const giacenzaScaduta = parseDbNumber(giacenzaScadutaPrecisa.toDb());
  const giacenzaDistribuibile = parseDbNumber(
    giacenzaDistribuibilePrecisa.toDb(),
  );
  const impegnato = parseDbNumber(impegnatoPreciso.toDb());
  return {
    prodottoId,
    magazzinoId,
    giacenzaFisica,
    giacenzaScaduta,
    giacenzaDistribuibile,
    impegnato,
    disponibileReale: parseDbNumber(disponibileRealePreciso.toDb()),
    giacenzaFisicaPrecisa: giacenzaFisicaPrecisa.toDb(),
    giacenzaScadutaPrecisa: giacenzaScadutaPrecisa.toDb(),
    giacenzaDistribuibilePrecisa: giacenzaDistribuibilePrecisa.toDb(),
    impegnatoPreciso: impegnatoPreciso.toDb(),
    disponibileRealePrecisa: disponibileRealePreciso.toDb(),
  };
}

export async function calcolaImpegnatoAttivoPrecisoPerGiacenze(
  pairs: Array<{ prodottoId: number; magazzinoId: number }>,
): Promise<Map<string, string>> {
  if (pairs.length === 0) return new Map();
  const prodottoIds = [...new Set(pairs.map((pair) => pair.prodottoId))];
  const magazzinoIds = [...new Set(pairs.map((pair) => pair.magazzinoId))];
  const requestedKeys = new Set(
    pairs.map((pair) =>
      disponibilitaMagazzinoKey(pair.prodottoId, pair.magazzinoId),
    ),
  );
  const dataOperativa = dataOperativaEuropeRome();
  const rows = await db
    .select({
      prodottoId: prenotazioniMagazzinoTable.prodottoId,
      magazzinoId: prenotazioniMagazzinoTable.magazzinoId,
      totale: sum(prenotazioniMagazzinoTable.quantita),
    })
    .from(prenotazioniMagazzinoTable)
    .innerJoin(
      lottiTable,
      eq(prenotazioniMagazzinoTable.lottoId, lottiTable.id),
    )
    .where(
      and(
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
        inArray(prenotazioniMagazzinoTable.prodottoId, prodottoIds),
        inArray(prenotazioniMagazzinoTable.magazzinoId, magazzinoIds),
        lottoDistribuibileCondition(dataOperativa),
      ),
    )
    .groupBy(
      prenotazioniMagazzinoTable.prodottoId,
      prenotazioniMagazzinoTable.magazzinoId,
    );
  const result = new Map<string, string>();
  for (const row of rows) {
    const key = disponibilitaMagazzinoKey(row.prodottoId, row.magazzinoId);
    if (requestedKeys.has(key)) {
      result.set(key, InventoryDecimal.parse(row.totale ?? "0").toDb());
    }
  }
  return result;
}

export async function calcolaImpegnatoAttivoPerGiacenze(
  pairs: Array<{ prodottoId: number; magazzinoId: number }>,
): Promise<Map<string, number>> {
  const precise = await calcolaImpegnatoAttivoPrecisoPerGiacenze(pairs);
  const result = new Map<string, number>();
  for (const [key, value] of precise) result.set(key, parseDbNumber(value));
  return result;
}
