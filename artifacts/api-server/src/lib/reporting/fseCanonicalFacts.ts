import { sql, type SQL } from "drizzle-orm";
import { signedMovementSql } from "../fseAccounting";
import type { ReportFilters } from "./types";
import { andSql, reportScope } from "./sql";
import { authoritativeSnapshotOrderForAliasS } from "./fseSnapshotOrder";

/** One net household population for cards, demographics and paginated detail. */
export function fseBeneficiaryProfilesCte(
  filters: ReportFilters,
  warehouseScope: SQL,
  authorized: SQL,
): SQL {
  const householdScope = andSql(
    reportScope(filters, {
      areaOperativa: sql`COALESCE(b.area_operativa_id_snapshot, be.area_operativa_id)`,
      centro: sql`COALESCE(b.centro_ascolto_id_snapshot, be.centro_ascolto_id)`,
      magazzino: sql`b.magazzino_id`,
    }),
  );
  return sql`WITH movimenti_famiglie AS (
    SELECT b.beneficiario_id, COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id, -mv.id) AS evento_id,
      SUM(${fseNetDistributedQuantity(sql`mv.quantita`)}) AS quantita_netta
    FROM movimenti mv LEFT JOIN movimenti original ON original.id=mv.movimento_origine_id
    JOIN magazzini mg ON mg.id=mv.magazzino_id
    LEFT JOIN bolla_righe br_famiglia ON br_famiglia.id=COALESCE(mv.bolla_riga_id, original.bolla_riga_id)
    JOIN bolle b ON b.id=COALESCE(mv.bolla_id, original.bolla_id, br_famiglia.bolla_id)
    JOIN beneficiari be ON be.id=b.beneficiario_id
    WHERE ${fseCanonicalPeriodCondition(filters, warehouseScope, authorized)} AND ${householdScope}
    GROUP BY b.beneficiario_id, evento_id
  ), famiglie AS (SELECT DISTINCT beneficiario_id FROM movimenti_famiglie WHERE quantita_netta <> 0),
  profili AS (
    SELECT f.beneficiario_id AS household_id, be.codice, fs.* FROM famiglie f JOIN beneficiari be ON be.id=f.beneficiario_id
    LEFT JOIN LATERAL (SELECT s.* FROM fse_fascicoli_sociali_snapshot s
      WHERE s.beneficiario_id=f.beneficiario_id AND s.data_riferimento<=${filters.a}
      ORDER BY ${authoritativeSnapshotOrderForAliasS} LIMIT 1) fs ON true
  )`;
}

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

export const effectiveBollaRigaId = sql`COALESCE(
  mv.bolla_riga_id,
  original.bolla_riga_id
)`;

export const effectiveDistributionOperationId = sql`COALESCE(
  mv.operazione_distribuzione_id,
  original.operazione_distribuzione_id
)`;

export const effectiveDistributionChannel = sql`COALESCE(
  mv.canale_operativo,
  original.canale_operativo
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
