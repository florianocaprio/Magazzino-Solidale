import { auditConfigurazioniTable, type db } from "@workspace/db";
import type { Request } from "express";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function auditLogistica(
  tx: Tx,
  req: Request,
  input: {
    entita: "volontario" | "mezzo" | "turno";
    id: number;
    azione: string;
    precedente?: Record<string, unknown> | null;
    nuovo?: Record<string, unknown> | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.insert(auditConfigurazioniTable).values({
    area: "logistica",
    chiave: `${input.entita}:${input.id}`,
    valorePrecedente: input.precedente ?? null,
    valoreNuovo: input.nuovo ?? null,
    utenteId: req.user?.id && req.user.id > 0 ? req.user.id : null,
    azione: input.azione,
    ip: req.ip ?? null,
    note: input.note ?? null,
  });
}
