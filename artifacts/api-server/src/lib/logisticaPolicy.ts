import {
  db,
  mezziTable,
  turniTable,
  turniVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";

export type LogisticaTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const FASCE_TURNO = ["09-13", "14-18", "18-20"] as const;
export type FasciaTurno = (typeof FASCE_TURNO)[number];

export const STATI_APPROVAZIONE = ["in_attesa", "approvato", "respinto"] as const;
export const STATI_MEZZO = [
  "disponibile",
  "non_disponibile",
  "manutenzione",
  "respinto",
  "ritirato",
] as const;
export const STATI_TURNO = ["pianificato", "confermato", "completato", "annullato"] as const;

export class LogisticaPolicyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isFasciaTurno(value: unknown): value is FasciaTurno {
  return typeof value === "string" && FASCE_TURNO.includes(value as FasciaTurno);
}

export function parseRequiredVersion(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeTarga(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value).trim().toUpperCase().replace(/\s+/g, " ");
}

export function effectiveMezzoCentroSql(
  volontarioId: SQL,
  proprietarioCentroId: SQL,
  mezzoCentroId: SQL,
): SQL<number | null> {
  return sql<number | null>`CASE
    WHEN ${volontarioId} IS NOT NULL THEN ${proprietarioCentroId}
    ELSE ${mezzoCentroId}
  END`;
}

export const effectiveMezzoCentroExpr = effectiveMezzoCentroSql(
  sql`${mezziTable.volontarioId}`,
  sql`${volontariTable.centroAscoltoId}`,
  sql`${mezziTable.centroAscoltoId}`,
);

export function effectiveCentroFromMezzo(
  mezzo: Pick<typeof mezziTable.$inferSelect, "volontarioId" | "centroAscoltoId">,
  proprietarioCentroId: number | null,
): number | null {
  return mezzo.volontarioId != null
    ? (proprietarioCentroId ?? null)
    : (mezzo.centroAscoltoId ?? null);
}

export function effectiveCentroFilter(centroId: number | null): SQL | undefined {
  if (centroId == null) return undefined;
  return sql`(${effectiveMezzoCentroExpr} IS NULL OR ${effectiveMezzoCentroExpr} = ${centroId})`;
}

export function effectiveAreaOperativaFilter(
  areaOperativaCentroIds: number[] | null,
): SQL | undefined {
  if (areaOperativaCentroIds == null) return undefined;
  if (areaOperativaCentroIds.length === 0) return sql`${effectiveMezzoCentroExpr} IS NULL`;
  return or(
    sql`${effectiveMezzoCentroExpr} IS NULL`,
    inArray(effectiveMezzoCentroExpr, areaOperativaCentroIds),
  );
}

export async function effectiveCentroMezzoTx(
  tx: LogisticaTx,
  mezzo: Pick<typeof mezziTable.$inferSelect, "volontarioId" | "centroAscoltoId">,
): Promise<number | null> {
  if (mezzo.volontarioId == null) return effectiveCentroFromMezzo(mezzo, null);
  const [owner] = await tx
    .select({ centroAscoltoId: volontariTable.centroAscoltoId })
    .from(volontariTable)
    .where(eq(volontariTable.id, mezzo.volontarioId));
  return effectiveCentroFromMezzo(mezzo, owner?.centroAscoltoId ?? null);
}

function compatibleCentro(resourceCentroId: number | null, targetCentroId: number): boolean {
  return resourceCentroId == null || resourceCentroId === targetCentroId;
}

export async function assertVolontarioAssignableTx(
  tx: LogisticaTx,
  input: {
    volontarioId: number;
    centroAscoltoId: number;
    data: string;
    fascia: FasciaTurno;
    excludeTurnoId?: number;
  },
): Promise<typeof volontariTable.$inferSelect> {
  const [volontario] = await tx
    .select()
    .from(volontariTable)
    .where(eq(volontariTable.id, input.volontarioId))
    .for("update");
  if (
    !volontario ||
    !volontario.attivo ||
    volontario.statoApprovazione !== "approvato" ||
    !compatibleCentro(volontario.centroAscoltoId, input.centroAscoltoId)
  ) {
    throw new LogisticaPolicyError(
      403,
      "Volontario non attivo, non approvato o non assegnabile al centro",
    );
  }

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(
      hashtext('turno-volontario-slot'),
      hashtext(${`${input.volontarioId}:${input.data}:${input.fascia}`})
    )`,
  );
  const conditions = [
    eq(turniVolontariTable.volontarioId, input.volontarioId),
    eq(turniTable.data, input.data),
    eq(turniTable.fascia, input.fascia),
    ne(turniTable.stato, "annullato"),
  ];
  if (input.excludeTurnoId != null) conditions.push(ne(turniTable.id, input.excludeTurnoId));
  const [conflict] = await tx
    .select({ id: turniTable.id })
    .from(turniVolontariTable)
    .innerJoin(turniTable, eq(turniVolontariTable.turnoId, turniTable.id))
    .where(and(...conditions))
    .limit(1);
  if (conflict) {
    throw new LogisticaPolicyError(
      409,
      "Volontario già assegnato a un altro turno in questa data e fascia",
    );
  }
  return volontario;
}

export async function assertMezzoAssignableTx(
  tx: LogisticaTx,
  input: {
    mezzoId: number;
    centroAscoltoId: number;
    data: string;
    fascia: FasciaTurno;
    excludeTurnoId?: number;
  },
): Promise<typeof mezziTable.$inferSelect> {
  const [mezzo] = await tx
    .select()
    .from(mezziTable)
    .where(eq(mezziTable.id, input.mezzoId))
    .for("update");
  if (!mezzo) throw new LogisticaPolicyError(403, "Mezzo non assegnabile al centro");
  const effectiveCentroId = await effectiveCentroMezzoTx(tx, mezzo);
  const scaduto =
    (mezzo.scadenzaAssicurazione != null && mezzo.scadenzaAssicurazione < input.data) ||
    (mezzo.scadenzaRevisione != null && mezzo.scadenzaRevisione < input.data);
  if (
    mezzo.stato !== "disponibile" ||
    mezzo.statoApprovazione !== "approvato" ||
    !compatibleCentro(effectiveCentroId, input.centroAscoltoId) ||
    scaduto
  ) {
    throw new LogisticaPolicyError(
      403,
      scaduto
        ? "Mezzo non assegnabile: assicurazione o revisione scaduta"
        : "Mezzo non disponibile, non approvato o non assegnabile al centro",
    );
  }

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(
      hashtext('turno-mezzo-slot'),
      hashtext(${`${input.mezzoId}:${input.data}:${input.fascia}`})
    )`,
  );
  const conditions = [
    eq(turniTable.mezzoId, input.mezzoId),
    eq(turniTable.data, input.data),
    eq(turniTable.fascia, input.fascia),
    ne(turniTable.stato, "annullato"),
  ];
  if (input.excludeTurnoId != null) conditions.push(ne(turniTable.id, input.excludeTurnoId));
  const [conflict] = await tx
    .select({ id: turniTable.id })
    .from(turniTable)
    .where(and(...conditions))
    .limit(1);
  if (conflict) {
    throw new LogisticaPolicyError(
      409,
      "Mezzo già assegnato a un altro turno in questa data e fascia",
    );
  }
  return mezzo;
}

export function isLogisticaUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 6; depth += 1) {
    if (typeof current === "object" && (current as { code?: string }).code === "23505") {
      return true;
    }
    current =
      typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
