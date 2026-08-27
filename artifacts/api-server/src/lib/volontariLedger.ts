import { createHash } from "node:crypto";
import { registroVolontariEventiTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import type { VolontariTx } from "./volontariOperational";

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

export async function appendVolontarioLedgerEvent(
  tx: VolontariTx,
  input: {
    sezione: "PERMANENTE" | "TEMPORANEO";
    tipoEvento:
      | "REGISTRAZIONE"
      | "SOSPENSIONE_CESSAZIONE"
      | "RIATTIVAZIONE"
      | "GIORNATA_TEMPORANEA"
      | "RETTIFICA";
    volontarioId: number;
    centroAscoltoId?: number | null;
    dataEffettiva: string;
    snapshot: Record<string, unknown>;
    utenteId?: number | null;
    eventoRettificatoId?: number | null;
  },
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('registro-volontari-ledger'))`);
  const [previous] = await tx
    .select({
      progressivo: registroVolontariEventiTable.progressivo,
      hashEvento: registroVolontariEventiTable.hashEvento,
    })
    .from(registroVolontariEventiTable)
    .orderBy(desc(registroVolontariEventiTable.progressivo))
    .limit(1);
  const hashPrecedente = previous?.hashEvento ?? null;
  const progressivo = (previous?.progressivo ?? 0) + 1;
  const hashEvento = createHash("sha256")
    .update(
      stable({
        ...input,
        progressivo,
        hashPrecedente,
      }),
    )
    .digest("hex");
  const [event] = await tx
    .insert(registroVolontariEventiTable)
    .values({
      ...input,
      progressivo,
      centroAscoltoId: input.centroAscoltoId ?? null,
      utenteId: input.utenteId ?? null,
      eventoRettificatoId: input.eventoRettificatoId ?? null,
      hashPrecedente,
      hashEvento,
    })
    .returning();
  return event;
}

export function canonicalSnapshotHash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}
