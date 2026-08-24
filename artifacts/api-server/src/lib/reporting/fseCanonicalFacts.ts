import { sql, type SQL } from "drizzle-orm";
import { signedMovementSql } from "../fseAccounting";
import type { ReportFilters } from "./types";

/**
 * Espressioni canoniche condivise dai report e dai drill-down FSE+.
 * Le alias SQL `mv` e `original` sono intenzionali e fanno parte del piccolo
 * contratto della sorgente: Movimento corrente + eventuale Movimento stornato.
 */
export const fseDistributionNatureCondition = sql`(
  mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
  OR (mv.natura_contabile = 'STORNO'
    AND original.natura_contabile = 'DISTRIBUZIONE_FINALE')
  OR (mv.natura_contabile = 'LEGACY' AND mv.tipo_movimento = 'scarico')
)`;

export function fseSignedQuantity(quantity: SQL): SQL {
  return signedMovementSql(
    quantity,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
}

export function fseNetDistributedQuantity(quantity: SQL): SQL {
  const signed = fseSignedQuantity(quantity);
  return sql`CASE WHEN mv.natura_contabile = 'LEGACY'
    THEN abs(${quantity}::numeric) ELSE -(${signed}) END`;
}

export function fseCanonicalPeriodCondition(
  filters: ReportFilters,
  warehouseScope: SQL,
  authorizedMovement: SQL,
): SQL {
  return sql`mv.fondo_origine = 'FSE_PLUS'
    AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
    AND ${fseDistributionNatureCondition}
    AND ${warehouseScope}
    AND ${authorizedMovement}`;
}
