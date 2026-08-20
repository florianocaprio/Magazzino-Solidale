import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";

export async function rows<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

export function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function scopeCondition(
  column: SQL,
  value: number | null,
  mode: "all" | "caller" | "query",
): SQL | null {
  if (value == null || mode === "all") return null;
  return mode === "caller"
    ? sql`(${column} = ${value} OR ${column} IS NULL)`
    : sql`${column} = ${value}`;
}

export function reportScope(
  filters: ReportFilters,
  columns: {
    areaOperativa?: SQL;
    centro?: SQL;
    magazzino?: SQL;
    mensa?: SQL;
    zona?: SQL;
    operatore?: SQL;
  },
): SQL[] {
  const conditions: SQL[] = [];
  if (columns.areaOperativa) {
    const condition = scopeCondition(
      columns.areaOperativa,
      filters.areaOperativaId,
      filters.areaOperativaMode,
    );
    if (condition) conditions.push(condition);
  }
  if (columns.centro) {
    const condition = scopeCondition(
      columns.centro,
      filters.centroAscoltoId,
      filters.centroMode,
    );
    if (condition) conditions.push(condition);
  }
  if (columns.zona) {
    const condition = scopeCondition(
      columns.zona,
      filters.zonaUdsId,
      filters.zonaMode,
    );
    if (condition) conditions.push(condition);
  }
  if (columns.magazzino && filters.magazzinoId != null) {
    conditions.push(sql`${columns.magazzino} = ${filters.magazzinoId}`);
  }
  if (columns.mensa && filters.mensaId != null) {
    conditions.push(sql`${columns.mensa} = ${filters.mensaId}`);
  }
  if (columns.operatore && filters.operatoreId != null) {
    conditions.push(sql`${columns.operatore} = ${filters.operatoreId}`);
  }
  return conditions;
}

export function andSql(conditions: SQL[]): SQL {
  return conditions.length === 0 ? sql`true` : sql.join(conditions, sql` AND `);
}

export function monthSeries(
  input: Array<Record<string, unknown>>,
  valueKey = "totale",
  secondaryKey?: string,
) {
  return input.map((row) => ({
    label: String(row.mese),
    value: number(row[valueKey]),
    ...(secondaryKey ? { secondaryValue: number(row[secondaryKey]) } : {}),
  }));
}

