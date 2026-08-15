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

async function findModuloAmbiente(codice: string) {
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
    .where(eq(moduliFunzionaliTable.codice, codice));
  return row;
}

export async function isModuloAttivo(codice: string): Promise<boolean> {
  const normalized = normalizeModuloCodice(codice);
  if (!normalized) return false;

  let row = await findModuloAmbiente(normalized);
  if (!row) {
    await ensureAmbienteModuli();
    row = await findModuloAmbiente(normalized);
  }

  if (!row) return false;
  if (row.modulo.core) return true;
  return row.ambiente?.attivo ?? row.modulo.attivoDefault;
}

export function requireModulo(codice: string, errorMessage?: string): RequestHandler {
  const normalized = normalizeModuloCodice(codice);
  return async (_req, res, next) => {
    if (await isModuloAttivo(normalized)) {
      next();
      return;
    }
    res.status(403).json({
      error: errorMessage ?? `Modulo ${normalized} non abilitato per questo ambiente`,
    });
  };
}

export function requireAnyModulo(
  codici: readonly string[],
  errorMessage?: string,
): RequestHandler {
  const normalized = codici.map(normalizeModuloCodice).filter(Boolean);
  return async (_req, res, next) => {
    const states = await Promise.all(normalized.map(isModuloAttivo));
    if (states.some(Boolean)) {
      next();
      return;
    }
    res.status(403).json({
      error:
        errorMessage ??
        `Nessuno dei moduli ${normalized.join(", ")} è abilitato per questo ambiente`,
    });
  };
}

export function requireAllModuli(
  codici: readonly string[],
  errorMessage?: string,
): RequestHandler {
  const normalized = codici.map(normalizeModuloCodice).filter(Boolean);
  return async (_req, res, next) => {
    const states = await Promise.all(normalized.map(isModuloAttivo));
    if (states.every(Boolean)) {
      next();
      return;
    }
    res.status(403).json({
      error:
        errorMessage ??
        `I moduli ${normalized.join(", ")} devono essere abilitati per questo ambiente`,
    });
  };
}
