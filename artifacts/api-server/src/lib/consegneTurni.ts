import { and, eq, ne, sql } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  consegneTable,
  turniTable,
} from "@workspace/db";
import {
  assertMezzoAssignableTx,
  assertVolontarioAssignableTx,
  fasciaTurnoConsegnaSql as canonicalFasciaTurnoConsegnaSql,
  fasciaTurnoFromConsegna,
  isFasciaConsegna,
  type FasciaConsegna,
  type FasciaTurno,
} from "./logisticaPolicy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type { FasciaConsegna } from "./logisticaPolicy";
export { fasciaTurnoFromConsegna, isFasciaConsegna } from "./logisticaPolicy";

export class ConsegnaPlanningError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function fasciaTurnoConsegnaSql() {
  return canonicalFasciaTurnoConsegnaSql(sql`${consegneTable.fasciaOraria}`);
}

type PlanningInput = Pick<
  typeof consegneTable.$inferSelect,
  "beneficiarioId" | "dataPrevista" | "fasciaOraria" | "volontarioId" | "mezzoId" | "mezzoAltro"
>;

/**
 * Validazione autoritativa delle assegnazioni della consegna. Viene eseguita
 * nella stessa transazione che crea/aggancia la consegna: i lock sullo slot,
 * sul volontario e sul mezzo rendono efficaci i controlli anche in concorrenza.
 */
export async function validateConsegnaPlanningTx(
  tx: Tx,
  input: PlanningInput,
  options: { excludeConsegnaId?: number } = {},
): Promise<{ centroAscoltoId: number | null; fasciaTurno: string | null }> {
  const [beneficiario] = await tx
    .select({ centroAscoltoId: beneficiariTable.centroAscoltoId })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, input.beneficiarioId));
  if (!beneficiario) throw new ConsegnaPlanningError(400, "Beneficiario non trovato");

  const centroAscoltoId = beneficiario.centroAscoltoId ?? null;
  const fasciaTurno = fasciaTurnoFromConsegna(input.fasciaOraria);
  if (input.fasciaOraria != null && fasciaTurno == null) {
    throw new ConsegnaPlanningError(400, "fasciaOraria non valida: usare Mattina, Pomeriggio o Sera");
  }
  if ((input.volontarioId != null || input.mezzoId != null) && fasciaTurno == null) {
    throw new ConsegnaPlanningError(400, "fasciaOraria è obbligatoria quando si assegna un volontario o un mezzo");
  }
  if (input.mezzoId != null && input.mezzoAltro) {
    throw new ConsegnaPlanningError(400, "Indicare un mezzo censito oppure Altro, non entrambi");
  }

  if ((input.volontarioId != null || input.mezzoId != null) && centroAscoltoId == null) {
    throw new ConsegnaPlanningError(403, "La consegna assegnata deve appartenere a un Centro");
  }

  const [targetTurno] = centroAscoltoId != null && fasciaTurno != null
    ? await tx.select({ id: turniTable.id }).from(turniTable).where(and(
        eq(turniTable.centroAscoltoId, centroAscoltoId),
        eq(turniTable.data, input.dataPrevista),
        eq(turniTable.fascia, fasciaTurno),
      )).limit(1)
    : [];

  // Lock order canonico: mezzo, proprietario effettivo, volontario assegnato.
  if (input.mezzoId != null) {
    try {
      await assertMezzoAssignableTx(tx, {
        mezzoId: input.mezzoId,
        centroAscoltoId: centroAscoltoId!,
        data: input.dataPrevista,
        fascia: fasciaTurno as FasciaTurno,
        excludeTurnoId: targetTurno?.id,
      });
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        throw new ConsegnaPlanningError((error as { status: number }).status, error.message);
      }
      throw error;
    }
  }

  if (input.volontarioId != null) {
    let volontario;
    try {
      volontario = await assertVolontarioAssignableTx(tx, {
        volontarioId: input.volontarioId,
        centroAscoltoId: centroAscoltoId!,
        data: input.dataPrevista,
        fascia: fasciaTurno as FasciaTurno,
        excludeTurnoId: targetTurno?.id,
      });
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        throw new ConsegnaPlanningError((error as { status: number }).status, error.message);
      }
      throw error;
    }
    if (volontario.maxConsegneTurno > 0) {
      const conditions = [
        eq(consegneTable.volontarioId, input.volontarioId),
        eq(consegneTable.dataPrevista, input.dataPrevista),
        ne(consegneTable.stato, "annullata"),
        eq(fasciaTurnoConsegnaSql(), fasciaTurno),
      ];
      if (options.excludeConsegnaId != null) conditions.push(ne(consegneTable.id, options.excludeConsegnaId));
      const assegnate = await tx.select({ id: consegneTable.id }).from(consegneTable).where(and(...conditions));
      if (assegnate.length >= volontario.maxConsegneTurno) {
        throw new ConsegnaPlanningError(400, "Il volontario ha già raggiunto il numero massimo di consegne per questo turno");
      }
    }
  }

  return { centroAscoltoId, fasciaTurno };
}
