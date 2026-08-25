import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality, text } from "./shared";
import { isModuloAttivo } from "../featureFlags";
import { signedMovementSql } from "../fseAccounting";

function warehouseConditions(
  filters: ReportFilters,
  alias: "mg" | "mo" | "md" = "mg",
): SQL[] {
  const areaOperativa =
    alias === "mg"
      ? sql`mg.area_operativa_id`
      : alias === "mo"
        ? sql`mo.area_operativa_id`
        : sql`md.area_operativa_id`;
  const centro =
    alias === "mg"
      ? sql`mg.centro_ascolto_id`
      : alias === "mo"
        ? sql`mo.centro_ascolto_id`
        : sql`md.centro_ascolto_id`;
  const id =
    alias === "mg" ? sql`mg.id` : alias === "mo" ? sql`mo.id` : sql`md.id`;
  return reportScope(
    filters,
    { areaOperativa, centro, magazzino: id },
    { sharedAreaOperativa: true, sharedCentro: true },
  );
}

function movementConditions(filters: ReportFilters): SQL[] {
  return [
    sql`mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}`,
    ...warehouseConditions(filters),
  ];
}

function transferCondition(filters: ReportFilters): SQL {
  const origin = andSql(warehouseConditions(filters, "mo"));
  const destination = andSql(warehouseConditions(filters, "md"));
  return sql`(${origin} OR ${destination})`;
}

export async function buildLogisticaReport(filters: ReportFilters) {
  const [
    magazzinoEnabled,
    lottiEnabled,
    trasferimentiEnabled,
    approvvigionamentiEnabled,
    mezziEnabled,
  ] = await Promise.all([
    isModuloAttivo("MAGAZZINO_SOLIDALE"),
    isModuloAttivo("LOTTI"),
    isModuloAttivo("TRASFERIMENTI"),
    isModuloAttivo("APPROVVIGIONAMENTI"),
    isModuloAttivo("MEZZI"),
  ]);
  const warehouseWhere = andSql(warehouseConditions(filters));
  const movementWhere = andSql(movementConditions(filters));
  const transferWhere = transferCondition(filters);
  const signedPieces = signedMovementSql(
    sql`mv.quantita_pezzi`,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
  const signedKgLt = signedMovementSql(
    sql`mv.quantita_kg_lt`,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
  const signedQuantity = signedMovementSql(
    sql`mv.quantita`,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
  const [
    stock,
    accounting,
    movements,
    transfers,
    supplies,
    means,
    monthly,
    warehouses,
    movementTypes,
    transferStates,
    dqRows,
  ] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      WITH stock AS (
        SELECT l.magazzino_id, l.prodotto_id, SUM(l.quantita_residua::numeric) AS quantita
        FROM lotti l JOIN magazzini mg ON mg.id = l.magazzino_id
        WHERE ${warehouseWhere} GROUP BY l.magazzino_id, l.prodotto_id
      ), lot_asof AS (
        SELECT mv.lotto_id, mv.magazzino_id, SUM(${signedQuantity}) AS quantita
        FROM movimenti mv
        LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
        JOIN magazzini mg ON mg.id = mv.magazzino_id
        WHERE mv.lotto_id IS NOT NULL
          AND mv.data_movimento <= ${filters.a}
          AND ${warehouseWhere}
        GROUP BY mv.lotto_id, mv.magazzino_id
      )
      SELECT COUNT(DISTINCT mg.id) AS magazzini,
             COUNT(*) FILTER (WHERE stock.quantita > 0) AS prodotti,
             (SELECT COUNT(*) FROM lotti l JOIN magazzini mg ON mg.id = l.magazzino_id
               WHERE l.quantita_residua::numeric > 0 AND ${warehouseWhere}) AS lotti,
             COUNT(*) FILTER (WHERE stock.quantita <= p.scorta_minima::numeric) AS sotto_scorta,
             (SELECT COUNT(*) FROM lot_asof la JOIN lotti l ON l.id = la.lotto_id
               WHERE la.quantita > 0 AND l.data_scadenza < ${filters.a}::date) AS scaduti,
             (SELECT COUNT(*) FROM lot_asof la JOIN lotti l ON l.id = la.lotto_id
               WHERE la.quantita > 0 AND l.data_scadenza BETWEEN ${filters.a}::date AND ${filters.a}::date + 7) AS scadenza_7,
             (SELECT COUNT(*) FROM lot_asof la JOIN lotti l ON l.id = la.lotto_id
               WHERE la.quantita > 0 AND l.data_scadenza BETWEEN ${filters.a}::date AND ${filters.a}::date + 15) AS scadenza_15,
             (SELECT COUNT(*) FROM lot_asof la JOIN lotti l ON l.id = la.lotto_id
               WHERE la.quantita > 0 AND l.data_scadenza BETWEEN ${filters.a}::date AND ${filters.a}::date + 30) AS scadenza_30
      FROM magazzini mg LEFT JOIN stock ON stock.magazzino_id = mg.id
      LEFT JOIN prodotti p ON p.id = stock.prodotto_id
      WHERE ${warehouseWhere}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT
        COALESCE(SUM(CASE WHEN lower(p.unita_misura) = 'pz'
          THEN l.quantita_residua::numeric
          WHEN l.fattore_kg_lt_pezzo IS NOT NULL
          THEN l.quantita_residua::numeric / l.fattore_kg_lt_pezzo::numeric
          ELSE 0 END), 0)::text AS corrente_pezzi,
        COALESCE(SUM(CASE WHEN lower(p.unita_misura) IN ('kg','lt','l')
          THEN l.quantita_residua::numeric
          WHEN lower(p.unita_misura) = 'pz' AND l.fattore_kg_lt_pezzo IS NOT NULL
          THEN l.quantita_residua::numeric * l.fattore_kg_lt_pezzo::numeric
          ELSE 0 END), 0)::text AS corrente_kg_lt,
        COALESCE((SELECT SUM(${signedPieces})
          FROM movimenti mv LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
          JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE mv.data_movimento <= ${filters.a} AND ${warehouseWhere}), 0)::text AS asof_pezzi,
        COALESCE((SELECT SUM(${signedKgLt})
          FROM movimenti mv LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
          JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE mv.data_movimento <= ${filters.a} AND ${warehouseWhere}), 0)::text AS asof_kg_lt,
        (SELECT COUNT(*) FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE mv.data_movimento BETWEEN ${filters.da} AND ${filters.a} AND mv.natura_contabile = 'STORNO' AND ${warehouseWhere}) AS storni,
        (SELECT COUNT(*) FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE mv.data_movimento BETWEEN ${filters.da} AND ${filters.a} AND mv.natura_contabile = 'RESO' AND ${warehouseWhere}) AS resi,
        (SELECT COUNT(*) FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE mv.data_movimento BETWEEN ${filters.da} AND ${filters.a} AND mv.natura_contabile IN ('RETTIFICA_POSITIVA','RETTIFICA_NEGATIVA','SCARTO') AND ${warehouseWhere}) AS rettifiche,
        (SELECT COUNT(*) FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE mv.data_movimento BETWEEN ${filters.da} AND ${filters.a} AND mv.natura_contabile = 'TRASFERIMENTO_INTERNO_ENTRATA' AND ${warehouseWhere}) AS trasferimenti_entrata,
        (SELECT COUNT(*) FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE mv.data_movimento BETWEEN ${filters.da} AND ${filters.a} AND mv.natura_contabile = 'TRASFERIMENTO_INTERNO_USCITA' AND ${warehouseWhere}) AS trasferimenti_uscita
      FROM lotti l JOIN magazzini mg ON mg.id = l.magazzino_id
      JOIN prodotti p ON p.id = l.prodotto_id WHERE ${warehouseWhere}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE mv.tipo_movimento = 'carico') AS carichi,
             COUNT(*) FILTER (WHERE mv.tipo_movimento = 'scarico') AS scarichi
      FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE ${movementWhere}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE tr.stato = 'richiesto') AS richiesti,
             COUNT(*) FILTER (WHERE tr.stato IN ('avviato', 'in_transito')) AS in_transito,
             COUNT(*) FILTER (WHERE tr.stato IN ('completato', 'confermato')) AS completati
      FROM trasferimenti tr
      JOIN magazzini mo ON mo.id = tr.magazzino_origine_id
      JOIN magazzini md ON md.id = tr.magazzino_destino_id
      WHERE tr.data_richiesta BETWEEN ${filters.da} AND ${filters.a} AND ${transferWhere}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS aperti FROM approvvigionamenti ap
      LEFT JOIN magazzini mg ON mg.id = ap.magazzino_id
      WHERE ap.stato IN ('bozza', 'sottomesso')
        AND ap.data_richiesta BETWEEN ${filters.da} AND ${filters.a}
        AND ${andSql(
          reportScope(filters, {
            areaOperativa: sql`mg.area_operativa_id`,
            centro: sql`ap.centro_ascolto_id`,
            magazzino: sql`ap.magazzino_id`,
          }),
        )}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(DISTINCT uso.mezzo_id) AS mezzi
      FROM (
        SELECT c.mezzo_id, be.area_operativa_id, be.centro_ascolto_id
        FROM consegne c JOIN beneficiari be ON be.id = c.beneficiario_id
        WHERE c.mezzo_id IS NOT NULL AND c.data_prevista BETWEEN ${filters.da} AND ${filters.a}
        UNION ALL
        SELECT b.mezzo_id, be.area_operativa_id, be.centro_ascolto_id
        FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE b.mezzo_id IS NOT NULL AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
      ) uso
      WHERE ${andSql(reportScope(filters, { areaOperativa: sql`uso.area_operativa_id`, centro: sql`uso.centro_ascolto_id` }))}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT to_char(mv.data_movimento, 'YYYY-MM') AS mese,
             COUNT(*) FILTER (WHERE mv.tipo_movimento = 'carico') AS carichi,
             COUNT(*) FILTER (WHERE mv.tipo_movimento = 'scarico') AS scarichi
      FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE ${movementWhere} GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      WITH lot_asof AS (
        SELECT mv.lotto_id, mv.magazzino_id, mv.prodotto_id,
               SUM(${signedQuantity}) AS quantita
        FROM movimenti mv
        LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
        JOIN magazzini scoped_mg ON scoped_mg.id = mv.magazzino_id
        WHERE mv.lotto_id IS NOT NULL
          AND mv.data_movimento <= ${filters.a}
          AND ${andSql(
            reportScope(filters, {
              areaOperativa: sql`scoped_mg.area_operativa_id`,
              centro: sql`scoped_mg.centro_ascolto_id`,
              magazzino: sql`scoped_mg.id`,
            }),
          )}
        GROUP BY mv.lotto_id, mv.magazzino_id, mv.prodotto_id
      )
      SELECT mg.id AS magazzino_id, mg.nome AS magazzino_nome, p.unita_misura,
             COUNT(DISTINCT l.prodotto_id) FILTER (WHERE l.quantita_residua::numeric > 0) AS prodotti,
             COALESCE(SUM(l.quantita_residua::numeric), 0) AS quantita,
             (SELECT COUNT(*) FROM lot_asof la
                JOIN lotti historical_lot ON historical_lot.id = la.lotto_id
                JOIN prodotti historical_product ON historical_product.id = la.prodotto_id
               WHERE la.magazzino_id = mg.id
                 AND historical_product.unita_misura IS NOT DISTINCT FROM p.unita_misura
                 AND la.quantita > 0
                 AND historical_lot.data_scadenza < ${filters.a}::date) AS scaduti
      FROM magazzini mg LEFT JOIN lotti l ON l.magazzino_id = mg.id
      LEFT JOIN prodotti p ON p.id = l.prodotto_id
      WHERE ${warehouseWhere} GROUP BY mg.id, mg.nome, p.unita_misura ORDER BY mg.nome, p.unita_misura
    `),
    rows<Record<string, unknown>>(sql`
      SELECT mv.tipo_movimento AS tipo, mv.tipo_dettaglio AS causale,
             mv.unita_misura, COUNT(*) AS movimenti,
             COALESCE(SUM(abs(mv.quantita::numeric)), 0) AS quantita
      FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE ${movementWhere}
      GROUP BY mv.tipo_movimento, mv.tipo_dettaglio, mv.unita_misura
      ORDER BY movimenti DESC, causale, mv.unita_misura
    `),
    rows<Record<string, unknown>>(sql`
      SELECT tr.stato, COUNT(*) AS totale
      FROM trasferimenti tr JOIN magazzini mo ON mo.id = tr.magazzino_origine_id
      JOIN magazzini md ON md.id = tr.magazzino_destino_id
      WHERE tr.data_richiesta BETWEEN ${filters.da} AND ${filters.a} AND ${transferWhere}
      GROUP BY tr.stato ORDER BY totale DESC, tr.stato
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE l.data_scadenza IS NULL) AS scadenza_mancante,
             COUNT(*) FILTER (WHERE l.fondo_origine = 'NESSUN_FONDO' AND l.fornitore_id IS NULL) AS provenienza_mancante
      FROM lotti l JOIN magazzini mg ON mg.id = l.magazzino_id
      WHERE l.quantita_residua::numeric > 0 AND ${warehouseWhere}
    `),
  ]);
  const st = stock[0] ?? {};
  const ac = accounting[0] ?? {};
  const mv = movements[0] ?? {};
  const tr = transfers[0] ?? {};
  const dq = dqRows[0] ?? {};

  const reportKpi = [];
  if (magazzinoEnabled || lottiEnabled) {
    reportKpi.push(
      kpi(
        "giacenzaCorrentePezzi",
        number(ac.corrente_pezzi),
        "pieces",
        null,
        "ok",
        String(ac.corrente_pezzi ?? "0"),
      ),
      kpi(
        "giacenzaCorrenteKgLt",
        number(ac.corrente_kg_lt),
        "kgLt",
        null,
        "ok",
        String(ac.corrente_kg_lt ?? "0"),
      ),
      kpi(
        "giacenzaAsOfPezzi",
        number(ac.asof_pezzi),
        "pieces",
        null,
        "ok",
        String(ac.asof_pezzi ?? "0"),
      ),
      kpi(
        "giacenzaAsOfKgLt",
        number(ac.asof_kg_lt),
        "kgLt",
        null,
        "ok",
        String(ac.asof_kg_lt ?? "0"),
      ),
      kpi("magazziniVisibili", number(st.magazzini)),
      kpi("prodottiPresenti", number(st.prodotti)),
      kpi("prodottiSottoScorta", number(st.sotto_scorta)),
      kpi("movimentiCarico", number(mv.carichi), "count", "movimentiCarico"),
      kpi("movimentiScarico", number(mv.scarichi), "count", "movimentiScarico"),
      kpi("storni", number(ac.storni)),
      kpi("resi", number(ac.resi)),
      kpi("modificheGiacenza", number(ac.rettifiche)),
      kpi("trasferimentiEntrata", number(ac.trasferimenti_entrata)),
      kpi("trasferimentiUscita", number(ac.trasferimenti_uscita)),
    );
  }
  if (lottiEnabled) {
    reportKpi.push(
      kpi("lottiAttivi", number(st.lotti)),
      kpi("lottiScadenza7", number(st.scadenza_7)),
      kpi("lottiScadenza15", number(st.scadenza_15)),
      kpi("lottiScadenza30", number(st.scadenza_30)),
      kpi("merceScaduta", number(st.scaduti)),
    );
  }
  if (trasferimentiEnabled) {
    reportKpi.push(
      kpi(
        "trasferimentiRichiesti",
        number(tr.richiesti),
        "count",
        "trasferimenti",
      ),
      kpi(
        "trasferimentiInTransito",
        number(tr.in_transito),
        "count",
        "trasferimenti",
      ),
      kpi(
        "trasferimentiCompletati",
        number(tr.completati),
        "count",
        "trasferimenti",
      ),
    );
  }
  if (approvvigionamentiEnabled)
    reportKpi.push(
      kpi("approvvigionamentiAperti", number(supplies[0]?.aperti)),
    );
  if (mezziEnabled)
    reportKpi.push(kpi("mezziUtilizzati", number(means[0]?.mezzi)));

  return dashboard({
    section: "magazzino-logistica",
    filters,
    kpi: reportKpi,
    series:
      magazzinoEnabled || lottiEnabled
        ? [
            {
              key: "movimentiPerMese",
              points: monthSeries(monthly, "carichi", "scarichi"),
            },
          ]
        : [],
    tables: [
      ...(magazzinoEnabled || lottiEnabled
        ? [
            {
              key: "giacenze",
              columns: [
                "magazzinoId",
                "magazzinoNome",
                "unitaMisura",
                "prodotti",
                "quantita",
                "scaduti",
              ],
              rows: warehouses.map((r) => ({
                magazzinoId: number(r.magazzino_id),
                magazzinoNome: String(r.magazzino_nome),
                unitaMisura:
                  r.unita_misura == null ? null : String(r.unita_misura),
                prodotti: number(r.prodotti),
                quantita: number(r.quantita),
                scaduti: number(r.scaduti),
              })),
            },
            {
              key: "causali",
              columns: [
                "tipo",
                "causale",
                "unitaMisura",
                "movimenti",
                "quantita",
              ],
              rows: movementTypes.map((r) => ({
                tipo: String(r.tipo),
                causale: String(r.causale),
                unitaMisura: String(r.unita_misura),
                movimenti: number(r.movimenti),
                quantita: number(r.quantita),
              })),
            },
          ]
        : []),
      ...(trasferimentiEnabled
        ? [
            {
              key: "trasferimenti",
              columns: ["stato", "totale"],
              rows: transferStates.map((r) => ({
                stato: String(r.stato),
                totale: number(r.totale),
              })),
            },
          ]
        : []),
    ],
    quality: lottiEnabled
      ? [
          quality(
            "scadenzaMancante",
            number(dq.scadenza_mancante),
            number(dq.scadenza_mancante) ? "derivable" : "ok",
          ),
          quality(
            "provenienzaMancante",
            number(dq.provenienza_mancante),
            number(dq.provenienza_mancante) ? "missing" : "ok",
          ),
        ]
      : [],
    definitions: [
      text("logisticsStock"),
      text("logisticsExpiryLedgerDate", { date: filters.a }),
      text("logisticsMovements"),
      text("logisticsUnits"),
    ],
  });
}

export { warehouseConditions, movementConditions, transferCondition };
