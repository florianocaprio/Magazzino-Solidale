import { reportExecutor, hasReportSnapshot } from "./queryContext";
import { ReportingError } from "./filters";
import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";

/** For Drizzle Date timestamps stored without time zone: the driver writes
 * ISO UTC and reads them as UTC. Do not use for civil DATE or local-time fields. */
export function utcTimestampRomeDate(column: SQL): SQL {
  return sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date`;
}

export async function rows<T extends Record<string, unknown>>(
  query: SQL,
): Promise<T[]> {
  const bounded = hasReportSnapshot();
  const result = await reportExecutor().execute(
    bounded ? sql`SELECT * FROM (${query}) report_bounded LIMIT 10001` : query,
  );
  if (bounded && result.rows.length > 10000)
    throw new ReportingError(
      413,
      "Report troppo ampio: restringere i filtri (massimo 10000 righe per insieme)",
    );
  return result.rows as T[];
}

export function number(value: unknown): number {
  // Solo proiezione visuale/count: i KPI contabili passano anche exactValue.
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function scopeCondition(
  column: SQL,
  value: number | null,
  mode: "all" | "caller" | "query",
  includeShared = false,
): SQL | null {
  if (value == null || mode === "all") return null;
  return includeShared
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
  options: {
    sharedAreaOperativa?: boolean;
    sharedCentro?: boolean;
  } = {},
): SQL[] {
  const conditions: SQL[] = [];
  if (columns.areaOperativa) {
    const condition = scopeCondition(
      columns.areaOperativa,
      filters.areaOperativaId,
      filters.areaOperativaMode,
      options.sharedAreaOperativa,
    );
    if (condition) conditions.push(condition);
  }
  if (columns.centro) {
    const condition = scopeCondition(
      columns.centro,
      filters.centroAscoltoId,
      filters.centroMode,
      options.sharedCentro,
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
  if (
    columns.mensa &&
    filters.callerMensaIds !== undefined &&
    filters.callerMensaIds !== null
  ) {
    conditions.push(
      filters.callerMensaIds.length
        ? sql`${columns.mensa} IN (${sql.join(
            filters.callerMensaIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql`false`,
    );
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
    exactValue: String(row[valueKey] ?? "0"),
    ...(secondaryKey
      ? {
          secondaryValue: number(row[secondaryKey]),
          exactSecondaryValue:
            row[secondaryKey] == null ? null : String(row[secondaryKey]),
        }
      : {}),
  }));
}
