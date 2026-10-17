import { sql } from "drizzle-orm";
import { andSql, reportScope, rows } from "./sql";
import {
  fseDistributionNatureCondition,
  fseNetDistributedQuantity,
  effectiveBollaRigaId,
} from "./fseCanonicalFacts";
import { text } from "./shared";
import type { ReportFilters } from "./types";
import type { ReportPanel } from "./requests";

/** Date of each ledger event, not the date of its original document. */
export async function distributionFlowPanel(
  filters: ReportFilters,
  emporio: boolean,
): Promise<ReportPanel> {
  const data = await rows<Record<string, string>>(sql`
    SELECT p.nome AS prodotto,mv.unita_misura AS unita,
      COALESCE(SUM(${fseNetDistributedQuantity(sql`mv.quantita`)}) FILTER (WHERE mv.natura_contabile <> 'STORNO'),0)::text AS lordo,
      COALESCE(SUM(${fseNetDistributedQuantity(sql`mv.quantita`)}) FILTER (WHERE mv.natura_contabile = 'STORNO'),0)::text AS compensazioni,
      SUM(${fseNetDistributedQuantity(sql`mv.quantita`)})::text AS netto
    FROM movimenti mv LEFT JOIN movimenti original ON original.id=mv.movimento_origine_id
    LEFT JOIN bolla_righe br ON br.id=${effectiveBollaRigaId}
    JOIN bolle b ON b.id=COALESCE(mv.bolla_id,original.bolla_id,br.bolla_id)
    JOIN beneficiari be ON be.id=b.beneficiario_id JOIN prodotti p ON p.id=mv.prodotto_id
    WHERE ${fseDistributionNatureCondition} AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
      AND ${emporio ? sql`EXISTS` : sql`NOT EXISTS`} (SELECT 1 FROM spese_emporio se WHERE se.bolla_id=b.id AND se.stato_spesa IN ('chiusa', 'stornata', 'stornata_parzialmente'))
      AND ${andSql(reportScope(filters, { areaOperativa: sql`COALESCE(b.area_operativa_id_snapshot,be.area_operativa_id)`, centro: sql`COALESCE(b.centro_ascolto_id_snapshot,be.centro_ascolto_id)`, magazzino: sql`b.magazzino_id` }))}
    GROUP BY p.id,p.nome,mv.unita_misura ORDER BY p.id,mv.unita_misura
  `);
  return {
    kpi: [],
    tables: [
      {
        key: "flussiDistribuzionePeriodo",
        columns: ["prodotto", "unita", "lordo", "compensazioni", "netto"],
        rows: data,
      },
    ],
    quality: [],
    definitions: [text("distributionPeriodFlow")],
  };
}
