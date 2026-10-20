import { and, eq, inArray } from "drizzle-orm";
import { beneficiariTable, creditoSolidaleMovimentiTable } from "@workspace/db";
import type { InventoryTransaction as Tx } from "./scaricoInventory";
import type { AuditCommandContext } from "./auditEvent";
import { appendCreditTx } from "./creditoSaldo";
import { creditoIntero } from "./creditoIntero";
import {
  commandRequestHash,
  loadDocumentCommand,
  storeDocumentCommand,
} from "./documentCommand";

const PERIOD_COMMAND = "credito.quota.periodo";
export type QuotaPeriodoReceipt = {
  quota: number;
  movimentoId: number | null;
  origine: string;
  periodo: string;
  nuova: boolean;
};
/** Il chiamante mantiene il lock UPDATE del beneficiario. Il registro durevole
 * esistente conserva anche la decisione quota zero, condivisa da primo accredito
 * e scheduler, senza aggiungere destinatari al gruppo congelato. */
export async function riconosciQuotaPeriodoTx(
  tx: Tx,
  b: typeof beneficiariTable.$inferSelect,
  input: {
    quota: number;
    periodo: string;
    origine: "attivazione_emporio" | "scheduler_mensile";
    motivo: string;
    command: AuditCommandContext;
    politicaId: number | null;
  },
): Promise<QuotaPeriodoReceipt> {
  const identity = {
    tipoComando: PERIOD_COMMAND,
    idempotencyKey: `${b.id}:${input.periodo}`,
  };
  const receipt = await loadDocumentCommand(tx, identity);
  if (receipt)
    return {
      ...(receipt.resultSnapshot as Omit<QuotaPeriodoReceipt, "nuova">),
      nuova: false,
    };
  // Lo storico già riconosciuto, anche stornato, non viene riaperto.
  const [previous] = await tx
    .select()
    .from(creditoSolidaleMovimentiTable)
    .where(
      and(
        eq(creditoSolidaleMovimentiTable.beneficiarioId, b.id),
        eq(creditoSolidaleMovimentiTable.periodoRiferimento, input.periodo),
        inArray(creditoSolidaleMovimentiTable.tipoMovimento, [
          "ricarica_mensile",
          "ricarica_iniziale",
        ]),
      ),
    )
    .limit(1);
  const quota = previous
    ? creditoIntero(
        previous.quotaMensileAssegnata ?? previous.variazioneCredito,
      )
    : creditoIntero(input.quota);
  const movement =
    previous ??
    (quota === 0
      ? null
      : await appendCreditTx(tx, {
          beneficiary: b,
          variazione: quota,
          tipo: "ricarica_mensile",
          periodo: input.periodo,
          origine: input.origine,
          politicaId: input.politicaId,
          motivo: input.motivo,
          command: input.command,
        }));
  const result = {
    quota,
    movimentoId: movement?.id ?? null,
    origine: previous?.origine ?? input.origine,
    periodo: input.periodo,
  };
  await storeDocumentCommand(tx, {
    ...identity,
    actorUserId:
      input.command.actor.actorType === "user"
        ? input.command.actor.actorUserId
        : 0,
    aggregatoTipo: "beneficiario",
    aggregatoId: b.id,
    requestHash: commandRequestHash({ beneficiarioId: b.id, ...result }),
    resultSnapshot: result,
  });
  return { ...result, nuova: !previous };
}
