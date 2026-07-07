import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import {
  ambienteModuliTable,
  db,
  moduliFunzionaliTable,
} from "@workspace/db";
import {
  CONFIGURAZIONE_AMBIENTE_ID,
  ensureAmbienteModuli,
} from "./configurazioneAmbiente";

function normalizeModuloCodice(codice: string): string {
  return codice.trim().toUpperCase();
}

export async function isModuloAttivo(codice: string): Promise<boolean> {
  const normalized = normalizeModuloCodice(codice);
  if (!normalized) return true;

  await ensureAmbienteModuli();

  const [row] = await db
    .select({ modulo: moduliFunzionaliTable, ambiente: ambienteModuliTable })
    .from(moduliFunzionaliTable)
    .leftJoin(
      ambienteModuliTable,
      and(
        eq(ambienteModuliTable.moduloId, moduliFunzionaliTable.id),
        eq(ambienteModuliTable.configurazioneAmbienteId, CONFIGURAZIONE_AMBIENTE_ID),
      ),
    )
    .where(eq(moduliFunzionaliTable.codice, normalized));

  if (!row) return true;
  if (row.modulo.core) return true;
  return row.ambiente?.attivo ?? row.modulo.attivoDefault;
}

export function requireModulo(codice: string): RequestHandler {
  const normalized = normalizeModuloCodice(codice);
  return async (_req, res, next) => {
    if (await isModuloAttivo(normalized)) {
      next();
      return;
    }
    res.status(403).json({
      error: `Modulo ${normalized} non abilitato per questo ambiente`,
    });
  };
}
