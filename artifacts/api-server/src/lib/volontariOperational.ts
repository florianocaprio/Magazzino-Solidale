import {
  copertureAssicurativeVolontariTable,
  db,
  giornateServizioVolontariTable,
  statiVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  evaluateOperationalState,
  type OperationalState,
} from "./volontariDomain";

export type VolontariTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type VolunteerBase = Pick<
  typeof volontariTable.$inferSelect,
  "id" | "statoApprovazione" | "attivo" | "tipoVolontario"
>;

export async function operationalStatesForRows(
  executor: typeof db | VolontariTx,
  rows: VolunteerBase[],
  riferimento: string,
  centroAscoltoId?: number | null,
): Promise<Map<number, OperationalState>> {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return new Map();
  const [coverages, events, days] = await Promise.all([
    executor
      .select({
        volontarioId: copertureAssicurativeVolontariTable.volontarioId,
        dataInizio: copertureAssicurativeVolontariTable.dataInizio,
        dataFine: copertureAssicurativeVolontariTable.dataFine,
        annullata: copertureAssicurativeVolontariTable.annullata,
      })
      .from(copertureAssicurativeVolontariTable)
      .where(inArray(copertureAssicurativeVolontariTable.volontarioId, ids)),
    executor
      .select({
        id: statiVolontariTable.id,
        volontarioId: statiVolontariTable.volontarioId,
        tipoEvento: statiVolontariTable.tipoEvento,
        dataEffettiva: statiVolontariTable.dataEffettiva,
      })
      .from(statiVolontariTable)
      .where(
        and(
          inArray(statiVolontariTable.volontarioId, ids),
          lte(statiVolontariTable.dataEffettiva, riferimento),
        ),
      )
      .orderBy(
        asc(statiVolontariTable.dataEffettiva),
        asc(statiVolontariTable.id),
      ),
    executor
      .select({ volontarioId: giornateServizioVolontariTable.volontarioId })
      .from(giornateServizioVolontariTable)
      .where(
        and(
          inArray(giornateServizioVolontariTable.volontarioId, ids),
          eq(giornateServizioVolontariTable.dataServizio, riferimento),
          inArray(giornateServizioVolontariTable.stato, [
            "PIANIFICATA",
            "PRESENTE",
          ]),
          centroAscoltoId == null
            ? undefined
            : or(
                eq(
                  giornateServizioVolontariTable.centroAscoltoId,
                  centroAscoltoId,
                ),
                isNull(giornateServizioVolontariTable.centroAscoltoId),
              ),
        ),
      ),
  ]);
  const coveragesById = new Map<number, typeof coverages>();
  for (const coverage of coverages) {
    const list = coveragesById.get(coverage.volontarioId) ?? [];
    list.push(coverage);
    coveragesById.set(coverage.volontarioId, list);
  }
  const lastEvent = new Map<number, (typeof events)[number]>();
  for (const event of events) lastEvent.set(event.volontarioId, event);
  const validDayIds = new Set(days.map((day) => day.volontarioId));
  return new Map(
    rows.map((row) => {
      const event = lastEvent.get(row.id);
      // I nuovi record in attesa nascono con attivo=false, ma non sono sospesi.
      // Per i legacy approvati senza storico manteniamo il valore amministrativo.
      const sospesoManualmente = event
        ? event.tipoEvento === "SOSPENSIONE"
        : row.statoApprovazione === "approvato" && !row.attivo;
      const amministrativamenteAttivo = !sospesoManualmente;
      return [
        row.id,
        evaluateOperationalState({
          approvazione: row.statoApprovazione,
          amministrativamenteAttivo,
          sospesoManualmente,
          tipoVolontario: row.tipoVolontario,
          riferimento,
          coperture: coveragesById.get(row.id) ?? [],
          giornataValida: validDayIds.has(row.id),
        }),
      ];
    }),
  );
}

export async function operationalStateForVolunteer(
  executor: typeof db | VolontariTx,
  volontarioId: number,
  riferimento: string,
  centroAscoltoId?: number | null,
): Promise<OperationalState | null> {
  const [row] = await executor
    .select({
      id: volontariTable.id,
      statoApprovazione: volontariTable.statoApprovazione,
      attivo: volontariTable.attivo,
      tipoVolontario: volontariTable.tipoVolontario,
    })
    .from(volontariTable)
    .where(eq(volontariTable.id, volontarioId));
  if (!row) return null;
  return (
    (
      await operationalStatesForRows(
        executor,
        [row],
        riferimento,
        centroAscoltoId,
      )
    ).get(volontarioId) ?? null
  );
}
