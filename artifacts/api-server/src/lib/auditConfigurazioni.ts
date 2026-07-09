import type { Request } from "express";
import { db, auditConfigurazioniTable } from "@workspace/db";

export type AuditConfigInput = {
  area: string;
  chiave: string;
  azione: string;
  valorePrecedente?: Record<string, unknown> | null;
  valoreNuovo?: Record<string, unknown> | null;
  utenteId?: number | null;
  ip?: string | null;
  note?: string | null;
};

export async function logConfigurazioneAudit(input: AuditConfigInput): Promise<void> {
  await db.insert(auditConfigurazioniTable).values({
    area: input.area,
    chiave: input.chiave,
    azione: input.azione,
    valorePrecedente: input.valorePrecedente ?? null,
    valoreNuovo: input.valoreNuovo ?? null,
    utenteId: input.utenteId ?? null,
    ip: input.ip ?? null,
    note: input.note ?? null,
  });
}

export function auditMetaFromRequest(req: Request): Pick<AuditConfigInput, "utenteId" | "ip"> {
  return {
    utenteId: req.user?.id ?? null,
    ip: req.ip ?? req.socket.remoteAddress ?? null,
  };
}
