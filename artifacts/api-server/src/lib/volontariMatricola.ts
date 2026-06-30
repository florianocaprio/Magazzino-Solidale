import { db, volontariTable } from "@workspace/db";
import { and, eq, ilike, ne, or, type SQL } from "drizzle-orm";

export const MATRICOLA_DUPLICATA_MSG = "La matricola indicata è già associata a un altro volontario.";
export const MATRICOLA_OBBLIGATORIA_MSG = "Matricola obbligatoria";

export type MatricolaDuplicataPayload = {
  error: string;
  matricolaSuggerita?: string;
};

export function normalizeVolontarioMatricola(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() || undefined : undefined;
}

export async function matricolaVolontarioGiaUsata(matricola: string, excludeId?: number): Promise<boolean> {
  const where = excludeId != null
    ? and(eq(volontariTable.matricola, matricola), ne(volontariTable.id, excludeId))
    : eq(volontariTable.matricola, matricola);
  const [existing] = await db
    .select({ id: volontariTable.id })
    .from(volontariTable)
    .where(where)
    .limit(1);
  return existing != null;
}

export async function suggerisciMatricolaVolontario(matricola: string, excludeId?: number): Promise<string | undefined> {
  const base = matricola.trim();
  if (!base) return undefined;
  const conditions: SQL[] = [
    or(eq(volontariTable.matricola, base), ilike(volontariTable.matricola, `${base}-%`))!,
  ];
  if (excludeId != null) conditions.push(ne(volontariTable.id, excludeId));
  const rows = await db
    .select({ matricola: volontariTable.matricola })
    .from(volontariTable)
    .where(and(...conditions));
  const usate = new Set(rows.map((r) => r.matricola?.trim()).filter(Boolean));
  for (let i = 1; i <= 99; i++) {
    const candidata = `${base}-${String(i).padStart(2, "0")}`;
    if (!usate.has(candidata)) return candidata;
  }
  return undefined;
}

export async function matricolaVolontarioDuplicataPayload(
  matricola: string,
  excludeId?: number,
): Promise<MatricolaDuplicataPayload> {
  const matricolaSuggerita = await suggerisciMatricolaVolontario(matricola, excludeId);
  return {
    error: matricolaSuggerita
      ? `${MATRICOLA_DUPLICATA_MSG} Puoi usare ad esempio: ${matricolaSuggerita}.`
      : MATRICOLA_DUPLICATA_MSG,
    ...(matricolaSuggerita ? { matricolaSuggerita } : {}),
  };
}

export function isVolontarioMatricolaUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; detail?: string } | null | undefined;
  return e?.code === "23505"
    && (e.constraint === "volontari_matricola_unique" || (e.detail?.includes("matricola") ?? false));
}
