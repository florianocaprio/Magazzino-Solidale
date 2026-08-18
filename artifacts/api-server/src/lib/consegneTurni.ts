import { and, eq, ne, sql } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  consegneTable,
  mezziTable,
  turniTable,
  turniVolontariTable,
  volontariTable,
} from "@workspace/db";
import { beneficiarioCentroId } from "./centroScope";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const FASCE_TURNO = {
  Mattina: "09-13",
  Pomeriggio: "14-18",
  Sera: "18-20",
} as const;

export type FasciaConsegna = keyof typeof FASCE_TURNO;

export class ConsegnaPlanningError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function fasciaTurnoFromConsegna(fascia: string | null | undefined): string | null {
  if (fascia == null) return null;
  return FASCE_TURNO[fascia as FasciaConsegna] ?? null;
}

export function isFasciaConsegna(value: unknown): value is FasciaConsegna {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FASCE_TURNO, value);
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

  if (fasciaTurno != null && (input.volontarioId != null || input.mezzoId != null)) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${centroAscoltoId ?? "null"}:${input.dataPrevista}:${fasciaTurno}`}))`);
  }

  if (input.volontarioId != null) {
    const [volontario] = await tx
      .select({
        id: volontariTable.id,
        centroAscoltoId: volontariTable.centroAscoltoId,
        attivo: volontariTable.attivo,
        statoApprovazione: volontariTable.statoApprovazione,
        maxConsegneTurno: volontariTable.maxConsegneTurno,
      })
      .from(volontariTable)
      .where(eq(volontariTable.id, input.volontarioId))
      .for("update");
    const centroCompatibile = volontario?.centroAscoltoId == null
      || (centroAscoltoId != null && volontario.centroAscoltoId === centroAscoltoId);
    if (!volontario || !volontario.attivo || volontario.statoApprovazione !== "approvato" || !centroCompatibile) {
      throw new ConsegnaPlanningError(403, "Volontario non attivo, non approvato o non assegnabile al centro della consegna");
    }
    if (volontario.maxConsegneTurno > 0) {
      const conditions = [
        eq(consegneTable.volontarioId, input.volontarioId),
        eq(consegneTable.dataPrevista, input.dataPrevista),
      ];
      if (options.excludeConsegnaId != null) conditions.push(ne(consegneTable.id, options.excludeConsegnaId));
      const assegnate = await tx.select({ id: consegneTable.id }).from(consegneTable).where(and(...conditions));
      if (assegnate.length >= volontario.maxConsegneTurno) {
        throw new ConsegnaPlanningError(400, "Il volontario ha già raggiunto il numero massimo di consegne per questo turno");
      }
    }
  }

  if (input.mezzoId != null) {
    const [mezzo] = await tx
      .select({
        id: mezziTable.id,
        centroAscoltoId: mezziTable.centroAscoltoId,
        volontarioId: mezziTable.volontarioId,
        stato: mezziTable.stato,
        statoApprovazione: mezziTable.statoApprovazione,
      })
      .from(mezziTable)
      .where(eq(mezziTable.id, input.mezzoId))
      .for("update");
    let proprietarioCentroId: number | null = null;
    if (mezzo?.volontarioId != null) {
      const [proprietario] = await tx
        .select({ centroAscoltoId: volontariTable.centroAscoltoId })
        .from(volontariTable)
        .where(eq(volontariTable.id, mezzo.volontarioId))
        .for("update");
      proprietarioCentroId = proprietario?.centroAscoltoId ?? null;
    }
    const effectiveCentroId = mezzo?.volontarioId != null
      ? proprietarioCentroId
      : (mezzo?.centroAscoltoId ?? null);
    const centroCompatibile = effectiveCentroId == null
      || (centroAscoltoId != null && effectiveCentroId === centroAscoltoId);
    if (!mezzo || mezzo.stato !== "disponibile" || mezzo.statoApprovazione !== "approvato" || !centroCompatibile) {
      throw new ConsegnaPlanningError(403, "Mezzo non disponibile, non approvato o non assegnabile al centro della consegna");
    }

    const conflitti = await tx
      .select({ id: turniTable.id, centroAscoltoId: turniTable.centroAscoltoId })
      .from(turniTable)
      .where(and(
        eq(turniTable.data, input.dataPrevista),
        eq(turniTable.fascia, fasciaTurno!),
        eq(turniTable.mezzoId, input.mezzoId),
      ));
    if (conflitti.some((turno) => turno.centroAscoltoId !== centroAscoltoId)) {
      throw new ConsegnaPlanningError(409, "Mezzo già assegnato a un altro turno in questa data e fascia");
    }
  }

  return { centroAscoltoId, fasciaTurno };
}

export async function syncTurnoDaConsegna(consegna: typeof consegneTable.$inferSelect) {
  if (consegna.volontarioId == null && consegna.mezzoId == null) return;
  const centroAscoltoId = await beneficiarioCentroId(consegna.beneficiarioId);
  await db.transaction((tx) => syncTurnoDaConsegnaTx(tx, consegna, centroAscoltoId));
}

export async function syncTurnoDaConsegnaTx(
  tx: Tx,
  consegna: typeof consegneTable.$inferSelect,
  centroAscoltoId: number | null,
): Promise<void> {
  if (consegna.volontarioId == null && consegna.mezzoId == null) return;
  const fascia = fasciaTurnoFromConsegna(consegna.fasciaOraria);
  if (centroAscoltoId == null || fascia == null) return;
  const [existing] = await tx.select().from(turniTable).where(and(
    eq(turniTable.centroAscoltoId, centroAscoltoId),
    eq(turniTable.data, consegna.dataPrevista),
    eq(turniTable.fascia, fascia),
  ));
  let turnoId: number;
  if (existing) {
    turnoId = existing.id;
    if (consegna.mezzoId != null && existing.mezzoId !== consegna.mezzoId) {
      if (existing.mezzoId != null) {
        throw new ConsegnaPlanningError(409, "Il turno selezionato ha già un mezzo diverso assegnato");
      }
      await tx.update(turniTable).set({ mezzoId: consegna.mezzoId }).where(eq(turniTable.id, turnoId));
    }
  } else {
    const [created] = await tx.insert(turniTable).values({
      centroAscoltoId,
      data: consegna.dataPrevista,
      fascia,
      mezzoId: consegna.mezzoId ?? null,
    }).returning();
    turnoId = created.id;
  }
  if (consegna.volontarioId != null) {
    const [already] = await tx.select({ id: turniVolontariTable.id }).from(turniVolontariTable).where(and(
      eq(turniVolontariTable.turnoId, turnoId),
      eq(turniVolontariTable.volontarioId, consegna.volontarioId),
    ));
    if (!already) {
      await tx.insert(turniVolontariTable).values({ turnoId, volontarioId: consegna.volontarioId, ruolo: "Consegna" });
    }
  }
}
