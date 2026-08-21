import { and, eq, inArray, sql } from "drizzle-orm";
import {
  beneficiariTable,
  consegneTable,
  db,
  turniConsegneTable,
  turniTable,
  turniVolontariTable,
} from "@workspace/db";
import type { Request } from "express";
import { auditLogistica } from "./logisticaAudit";
import { fasciaTurnoFromConsegna, type FasciaTurno } from "./logisticaPolicy";
import { ConsegnaPlanningError } from "./consegneTurni";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ConsegnaRow = typeof consegneTable.$inferSelect;

async function centroTx(tx: Tx, consegna: ConsegnaRow) {
  const [row] = await tx.select({ id: beneficiariTable.centroAscoltoId }).from(beneficiariTable)
    .where(eq(beneficiariTable.id, consegna.beneficiarioId));
  return row?.id ?? null;
}

async function lockSlot(tx: Tx, centroId: number, data: string, fascia: FasciaTurno) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(
    hashtext('turno-centro-slot'), hashtext(${`${centroId}:${data}:${fascia}`})
  )`);
}

/** Riconcilia solo le assegnazioni con provenienza persistita dalla Consegna. */
export async function reconcileConsegnaPlanningTx(
  tx: Tx,
  precedente: ConsegnaRow | null,
  nuovo: ConsegnaRow | null,
  req?: Request,
): Promise<void> {
  const consegnaId = nuovo?.id ?? precedente?.id;
  if (consegnaId == null) return;
  const [oldSource] = await tx.select().from(turniConsegneTable)
    .where(eq(turniConsegneTable.consegnaId, consegnaId)).for("update");
  const [oldTurno] = oldSource
    ? await tx.select().from(turniTable).where(eq(turniTable.id, oldSource.turnoId))
    : [];
  const centroId = nuovo ? await centroTx(tx, nuovo) : null;
  const fascia = nuovo ? fasciaTurnoFromConsegna(nuovo.fasciaOraria) : null;
  const hasSource = Boolean(nuovo && (nuovo.volontarioId != null || nuovo.mezzoId != null) && centroId != null && fascia != null);

  const slots = new Map<string, [number, string, FasciaTurno]>();
  if (oldTurno) slots.set(`${oldTurno.centroAscoltoId}:${oldTurno.data}:${oldTurno.fascia}`, [oldTurno.centroAscoltoId, oldTurno.data, oldTurno.fascia as FasciaTurno]);
  if (hasSource) slots.set(`${centroId}:${nuovo!.dataPrevista}:${fascia}`, [centroId!, nuovo!.dataPrevista, fascia!]);
  for (const [, slot] of [...slots].sort(([a], [b]) => a.localeCompare(b))) await lockSlot(tx, ...slot);

  if (oldSource) await tx.delete(turniConsegneTable).where(eq(turniConsegneTable.id, oldSource.id));
  const affected = new Set<number>(oldSource ? [oldSource.turnoId] : []);
  const created = new Set<number>();
  if (hasSource) {
    let [target] = await tx.select().from(turniTable).where(and(
      eq(turniTable.centroAscoltoId, centroId!),
      eq(turniTable.data, nuovo!.dataPrevista),
      eq(turniTable.fascia, fascia!),
    )).for("update");
    if (target?.stato === "completato") throw new ConsegnaPlanningError(409, "Il turno selezionato è già completato");
    if (!target) {
      [target] = await tx.insert(turniTable).values({
        centroAscoltoId: centroId!, data: nuovo!.dataPrevista, fascia: fascia!,
        mezzoId: nuovo!.mezzoId ?? null, mezzoManuale: nuovo!.mezzoId == null,
      }).returning();
      created.add(target.id);
    }
    affected.add(target.id);
    await tx.insert(turniConsegneTable).values({
      turnoId: target.id, consegnaId,
      volontarioId: nuovo!.volontarioId ?? null, mezzoId: nuovo!.mezzoId ?? null,
    });
  }

  for (const turnoId of [...affected].sort((a, b) => a - b)) {
    const [turno] = await tx.select().from(turniTable).where(eq(turniTable.id, turnoId)).for("update");
    if (!turno) continue;
    if (turno.stato === "completato") throw new ConsegnaPlanningError(409, "Un turno completato non può essere riconciliato");
    const sources = await tx.select().from(turniConsegneTable).where(eq(turniConsegneTable.turnoId, turnoId));
    const links = await tx.select().from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, turnoId));
    const desiredVol = new Set(sources.flatMap((s) => s.volontarioId == null ? [] : [s.volontarioId]));
    const removeIds = links.filter((l) => !l.manuale && !desiredVol.has(l.volontarioId)).map((l) => l.id);
    if (removeIds.length) await tx.delete(turniVolontariTable).where(inArray(turniVolontariTable.id, removeIds));
    const linked = new Set(links.map((l) => l.volontarioId));
    const missing = [...desiredVol].filter((id) => !linked.has(id));
    if (missing.length) await tx.insert(turniVolontariTable).values(missing.map((volontarioId) => ({ turnoId, volontarioId, ruolo: "Consegna", manuale: false })));

    const sourceMezzi = [...new Set(sources.flatMap((s) => s.mezzoId == null ? [] : [s.mezzoId]))];
    if (sourceMezzi.length > 1) throw new ConsegnaPlanningError(409, "Il turno riceve mezzi diversi da più consegne");
    const sourceMezzo = sourceMezzi[0] ?? null;
    if (sourceMezzo != null && turno.mezzoId != null && turno.mezzoId !== sourceMezzo && turno.mezzoManuale) {
      throw new ConsegnaPlanningError(409, "Il turno selezionato ha già un mezzo diverso impostato manualmente");
    }
    const mezzoId = sourceMezzo ?? (turno.mezzoManuale ? turno.mezzoId : null);
    const mezzoManuale = sourceMezzo != null ? turno.mezzoId === sourceMezzo && turno.mezzoManuale : mezzoId != null;
    const remainingVol = new Set([...links.filter((l) => l.manuale).map((l) => l.volontarioId), ...desiredVol]);
    const empty = remainingVol.size === 0 && mezzoId == null;
    const stato = empty ? "annullato" : turno.stato === "annullato" ? "pianificato" : turno.stato;
    const motivo = empty ? "Assegnazioni della consegna rimosse" : stato === "pianificato" ? null : turno.motivoAnnullamento;
    const joinChanged = removeIds.length > 0 || missing.length > 0;
    const rowChanged = turno.mezzoId !== mezzoId || turno.mezzoManuale !== mezzoManuale || turno.stato !== stato || turno.motivoAnnullamento !== motivo;
    let versione = turno.versione;
    if (rowChanged || (joinChanged && !created.has(turnoId))) {
      const [updated] = await tx.update(turniTable).set({
        mezzoId, mezzoManuale, stato, motivoAnnullamento: motivo,
        versione: sql`${turniTable.versione} + 1`, dataAggiornamento: new Date(),
      }).where(eq(turniTable.id, turnoId)).returning({ versione: turniTable.versione });
      versione = updated.versione;
    }
    if (req && (created.has(turnoId) || rowChanged || joinChanged)) await auditLogistica(tx, req, {
      entita: "turno", id: turnoId,
      azione: created.has(turnoId) ? "creazione_da_consegna" : empty ? "annullamento_da_consegna" : "riconciliazione_consegna",
      precedente: { stato: turno.stato, mezzoId: turno.mezzoId, volontari: links.map((l) => l.volontarioId), versione: turno.versione },
      nuovo: { stato, mezzoId, volontari: [...remainingVol], consegnaId, versione },
    });
  }
}
