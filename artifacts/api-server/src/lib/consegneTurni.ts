import { and, eq, ne, sql } from "drizzle-orm";
import {
  db,
  beneficiariTable,
  consegneTable,
  turniTable,
  turniVolontariTable,
} from "@workspace/db";
import type { Request } from "express";
import { beneficiarioCentroId } from "./centroScope";
import { auditLogistica } from "./logisticaAudit";
import {
  assertMezzoAssignableTx,
  assertVolontarioAssignableTx,
  type FasciaTurno,
} from "./logisticaPolicy";

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

export function fasciaTurnoConsegnaSql() {
  return sql<string>`CASE ${consegneTable.fasciaOraria}
    WHEN 'Mattina' THEN '09-13'
    WHEN 'Pomeriggio' THEN '14-18'
    WHEN 'Sera' THEN '18-20'
    ELSE NULL END`;
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
  req?: Request,
): Promise<void> {
  if (consegna.volontarioId == null && consegna.mezzoId == null) return;
  const fascia = fasciaTurnoFromConsegna(consegna.fasciaOraria);
  if (centroAscoltoId == null || fascia == null) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(
    hashtext('turno-centro-slot'),
    hashtext(${`${centroAscoltoId}:${consegna.dataPrevista}:${fascia}`})
  )`);
  const [existing] = await tx.select().from(turniTable).where(and(
    eq(turniTable.centroAscoltoId, centroAscoltoId),
    eq(turniTable.data, consegna.dataPrevista),
    eq(turniTable.fascia, fascia),
  )).for("update");
  let turnoId: number;
  let turnoVersione: number;
  let turnoModificato = false;
  let volontarioAggiunto = false;
  if (existing) {
    turnoId = existing.id;
    turnoVersione = existing.versione;
    if (existing.stato === "completato") {
      throw new ConsegnaPlanningError(409, "Il turno selezionato è già completato");
    }
    if (consegna.mezzoId != null && existing.mezzoId !== consegna.mezzoId) {
      if (existing.mezzoId != null) {
        throw new ConsegnaPlanningError(409, "Il turno selezionato ha già un mezzo diverso assegnato");
      }
      const [updated] = await tx.update(turniTable).set({ mezzoId: consegna.mezzoId, stato: "pianificato", motivoAnnullamento: null, versione: sql`${turniTable.versione} + 1`, dataAggiornamento: new Date() }).where(eq(turniTable.id, turnoId)).returning({ versione: turniTable.versione });
      turnoVersione = updated.versione;
      turnoModificato = true;
    } else if (existing.stato === "annullato") {
      const [updated] = await tx.update(turniTable).set({ stato: "pianificato", motivoAnnullamento: null, versione: sql`${turniTable.versione} + 1`, dataAggiornamento: new Date() }).where(eq(turniTable.id, turnoId)).returning({ versione: turniTable.versione });
      turnoVersione = updated.versione;
      turnoModificato = true;
    }
  } else {
    const [created] = await tx.insert(turniTable).values({
      centroAscoltoId,
      data: consegna.dataPrevista,
      fascia,
      mezzoId: consegna.mezzoId ?? null,
    }).returning();
    turnoId = created.id;
    turnoVersione = created.versione;
    turnoModificato = true;
  }
  if (consegna.volontarioId != null) {
    const [already] = await tx.select({ id: turniVolontariTable.id }).from(turniVolontariTable).where(and(
      eq(turniVolontariTable.turnoId, turnoId),
      eq(turniVolontariTable.volontarioId, consegna.volontarioId),
    ));
    if (!already) {
      await tx.insert(turniVolontariTable).values({ turnoId, volontarioId: consegna.volontarioId, ruolo: "Consegna" });
      volontarioAggiunto = true;
    }
  }
  if (req && (turnoModificato || volontarioAggiunto)) {
    await auditLogistica(tx, req, {
      entita: "turno",
      id: turnoId,
      azione: existing ? "sincronizzazione_consegna" : "creazione_da_consegna",
      precedente: existing
        ? { stato: existing.stato, mezzoId: existing.mezzoId, versione: existing.versione }
        : null,
      nuovo: {
        stato: existing?.stato === "annullato" ? "pianificato" : (existing?.stato ?? "pianificato"),
        mezzoId: consegna.mezzoId ?? existing?.mezzoId ?? null,
        volontarioId: consegna.volontarioId ?? null,
        versione: turnoVersione,
      },
    });
  }
}
