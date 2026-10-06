import { and, eq } from "drizzle-orm";
import {
  bolleTable,
  trasferimentiTable,
  prenotazioniMagazzinoTable,
  movimentiTable,
} from "@workspace/db";
import type { InventoryTransaction } from "./scaricoInventory";
import {
  auditFields,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";
import { DocumentCommandError } from "./documentCommand";
import {
  annullaInterventoDaBollaTx,
  scarichiFisiciBolla,
} from "./bollaDelivery";
import { dataCivileEuropeRome } from "./interventiWorkflow";
import {
  PRENOTAZIONE_ATTIVA,
  PRENOTAZIONE_RILASCIATA,
} from "./inventoryReservations";

// Callers authorize the command and lock request/link before the M4 document.
// These services are shared by direct M4 commands and request cancellation.
export async function cancelBollaBeforeExitTx(
  tx: InventoryTransaction,
  current: typeof bolleTable.$inferSelect,
  options: {
    actorId: number;
    motivo: string;
    audit: AuditCommandContext;
    preserveIntervention?: boolean;
  },
) {
  if (current.stato === "annullato")
    throw new DocumentCommandError(400, "La bolla è già annullata");
  if (
    !["bozza", "confermato"].includes(current.stato) ||
    (await scarichiFisiciBolla(tx, current.id)) > 0
  )
    throw new DocumentCommandError(
      409,
      "La merce è già uscita o il documento è finale: gestisci mancata consegna / rientro dal documento",
    );
  await tx
    .update(prenotazioniMagazzinoTable)
    .set({ stato: PRENOTAZIONE_RILASCIATA, updatedAt: new Date() })
    .where(
      and(
        eq(prenotazioniMagazzinoTable.bollaId, current.id),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
      ),
    );
  if (
    current.tipoDestinatario === "beneficiario" &&
    !options.preserveIntervention
  )
    await annullaInterventoDaBollaTx(
      tx,
      current.id,
      options.actorId,
      `Annullamento Bolla ${current.numeroBolla}: ${options.motivo}`,
    );
  const [updated] = await tx
    .update(bolleTable)
    .set({
      stato: "annullato",
      motivoAnnullamento: options.motivo,
      operatoreId: options.actorId,
      versione: current.versione + 1,
    })
    .where(eq(bolleTable.id, current.id))
    .returning();
  await recordAuditEvent(tx, {
    command: options.audit,
    azione: "BOLLA_ANNULLATA",
    entitaTipo: "bolla",
    entitaId: current.id,
    documentoTipo: "bolla",
    documentoId: current.id,
    areaOperativaIdSnapshot: current.areaOperativaIdSnapshot,
    centroAscoltoIdSnapshot: current.centroAscoltoIdSnapshot,
    magazzinoIdSnapshot: current.magazzinoId,
    dataOperativa: dataCivileEuropeRome(new Date()),
    motivo: options.motivo,
    changes: auditFields(
      { statoPrecedente: current.stato, statoNuovo: "annullato" },
      ["statoPrecedente", "statoNuovo"],
    ),
  });
  return updated;
}

export async function cancelTransferBeforeExitTx(
  tx: InventoryTransaction,
  current: typeof trasferimentiTable.$inferSelect,
  options: { actorId: number; motivo: string; audit: AuditCommandContext },
) {
  const exits = await tx
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.trasferimentoId, current.id),
        eq(movimentiTable.tipoMovimento, "trasferimento"),
        eq(movimentiTable.tipoDettaglio, "uscita"),
      ),
    )
    .limit(1);
  if (!["richiesto", "preparato"].includes(current.stato) || exits.length)
    throw new DocumentCommandError(
      409,
      "Annullamento ordinario consentito solo prima della partenza; gestisci mancato arrivo / rientro",
    );
  await tx
    .update(prenotazioniMagazzinoTable)
    .set({ stato: PRENOTAZIONE_RILASCIATA, updatedAt: new Date() })
    .where(
      and(
        eq(prenotazioniMagazzinoTable.trasferimentoId, current.id),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_ATTIVA),
      ),
    );
  const [updated] = await tx
    .update(trasferimentiTable)
    .set({
      stato: "annullato",
      motivoAnnullamento: options.motivo,
      operatoreId: options.actorId,
      versione: current.versione + 1,
    })
    .where(eq(trasferimentiTable.id, current.id))
    .returning();
  await recordAuditEvent(tx, {
    command: options.audit,
    azione: "TRASFERIMENTO_ANNULLATO",
    entitaTipo: "trasferimento",
    entitaId: current.id,
    documentoTipo: "trasferimento",
    documentoId: current.id,
    magazzinoIdSnapshot: current.magazzinoOrigineId,
    dataOperativa: dataCivileEuropeRome(new Date()),
    changes: auditFields(
      {
        statoPrecedente: current.stato,
        statoNuovo: "annullato",
        motivo: options.motivo,
      },
      ["statoPrecedente", "statoNuovo", "motivo"],
    ),
  });
  return updated;
}
