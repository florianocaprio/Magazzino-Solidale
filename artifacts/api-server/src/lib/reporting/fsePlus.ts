import { sql, type SQL } from "drizzle-orm";
import { isModuloAttivo } from "../featureFlags";
import type { ReportFilters } from "./types";
import { reportingAgeBandSql } from "./ageBands";
import { andSql, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";
import { signedMovementSql } from "../fseAccounting";

function fseScope(filters: ReportFilters) {
  return andSql(
    reportScope(filters, {
      areaOperativa: sql`be.area_operativa_id`,
      centro: sql`be.centro_ascolto_id`,
      magazzino: sql`b.magazzino_id`,
    }),
  );
}

type FseSources = {
  pacchi: boolean;
  emporio: boolean;
  mensa: boolean;
  uds: boolean;
};

async function activeFseSources(filters: ReportFilters): Promise<FseSources> {
  const [magazzino, bolle, emporio, mensa, uds] = await Promise.all([
    isModuloAttivo("MAGAZZINO_SOLIDALE"),
    isModuloAttivo("BOLLE"),
    isModuloAttivo("EMPORIO_SOLIDALE"),
    isModuloAttivo("MENSA"),
    isModuloAttivo("UDS"),
  ]);
  const canRead = (area: string) =>
    filters.callerIsAdmin || filters.callerAreas.includes(area);
  const canReadMensa =
    filters.callerIsAdmin ||
    filters.callerPermissions.includes("mensa.reports.view");
  return {
    pacchi: magazzino && bolle && canRead("sociale"),
    emporio: emporio && canRead("emporio"),
    mensa: mensa && canRead("mensa") && canReadMensa,
    uds: uds && canRead("uds"),
  };
}

export function fseBollaSourceCondition(filters: ReportFilters): SQL {
  if (filters.callerIsAdmin) return sql`true`;
  const pacchi = filters.callerAreas.includes("sociale");
  const emporio = filters.callerAreas.includes("emporio");
  if (pacchi && emporio) return sql`true`;
  if (emporio) {
    return sql`EXISTS (
      SELECT 1 FROM spese_emporio source_se
      WHERE source_se.bolla_id = b.id AND source_se.stato_spesa = 'chiusa'
    )`;
  }
  if (pacchi) {
    return sql`NOT EXISTS (
      SELECT 1 FROM spese_emporio source_se
      WHERE source_se.bolla_id = b.id AND source_se.stato_spesa = 'chiusa'
    )`;
  }
  return sql`false`;
}

export async function buildFsePlusReport(filters: ReportFilters) {
  const sources = await activeFseSources(filters);
  const scope = fseScope(filters);
  const warehouseScope = andSql(
    reportScope(filters, {
      areaOperativa: sql`mg.area_operativa_id`,
      centro: sql`mg.centro_ascolto_id`,
      magazzino: sql`mg.id`,
    }),
  );
  const sourceCondition = fseBollaSourceCondition({
    ...filters,
    callerAreas: [
      ...(sources.pacchi ? ["sociale"] : []),
      ...(sources.emporio ? ["emporio"] : []),
    ],
    callerIsAdmin: false,
  });
  const allowedCanonicalChannels = [
    ...(sources.pacchi ? ["PACCHI", "RITIRO_SEDE", "DOMICILIARE"] : []),
    ...(sources.emporio ? ["EMPORIO"] : []),
    ...(sources.mensa ? ["MENSA"] : []),
    ...(sources.uds ? ["UDS_STRADA"] : []),
  ];
  const authorizedFseMovement = sql`(
    (mv.natura_contabile <> 'LEGACY' AND ${
      allowedCanonicalChannels.length
        ? sql`COALESCE(mv.canale_operativo, original.canale_operativo) IN (${sql.join(
            allowedCanonicalChannels.map((channel) => sql`${channel}`),
            sql`, `,
          )})`
        : sql`false`
    })
    OR (mv.natura_contabile = 'LEGACY' AND EXISTS (
      SELECT 1 FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      WHERE b.id = mv.bolla_id AND ${scope} AND ${sourceCondition}
    ))
  )`;
  const ageBand = reportingAgeBandSql(
    sql`persone.data_nascita`,
    sql`persone.fascia_eta_presunta`,
    filters.a,
  );
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
    products,
    channels,
    channelQuantities,
    people,
    ageRows,
    sexRows,
    qualityRows,
    packageMeals,
    accountingRows,
    administrativeRows,
  ] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT p.id AS prodotto_id, p.nome AS prodotto_nome, mv.unita_misura,
             SUM(CASE
               WHEN mv.natura_contabile = 'LEGACY'
                 THEN abs(mv.quantita::numeric)
               ELSE -(${signedQuantity})
             END) AS quantita_fse,
             CASE WHEN bool_or(mv.natura_contabile = 'LEGACY') THEN
               (SELECT SUM(br2.quantita::numeric)
                FROM bolla_righe br2
                JOIN bolle b ON b.id = br2.bolla_id
                JOIN beneficiari be ON be.id = b.beneficiario_id
                WHERE br2.prodotto_id = p.id
                  AND b.stato = 'consegnato'
                  AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
                  AND ${scope} AND ${sourceCondition})
             ELSE SUM(CASE
               WHEN mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
                 THEN abs(mv.quantita::numeric) ELSE 0 END)
             END AS quantita_totale,
             CASE WHEN (CASE WHEN bool_or(mv.natura_contabile = 'LEGACY') THEN
               (SELECT SUM(br2.quantita::numeric)
                FROM bolla_righe br2
                JOIN bolle b ON b.id = br2.bolla_id
                JOIN beneficiari be ON be.id = b.beneficiario_id
                WHERE br2.prodotto_id = p.id
                  AND b.stato = 'consegnato'
                  AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
                  AND ${scope} AND ${sourceCondition})
             ELSE SUM(CASE
               WHEN mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
                 THEN abs(mv.quantita::numeric) ELSE 0 END) END) > 0
             THEN round(SUM(CASE
               WHEN mv.natura_contabile = 'LEGACY' THEN abs(mv.quantita::numeric)
               ELSE -(${signedQuantity}) END) * 100
               / (CASE WHEN bool_or(mv.natura_contabile = 'LEGACY') THEN
                 (SELECT SUM(br2.quantita::numeric)
                  FROM bolla_righe br2
                  JOIN bolle b ON b.id = br2.bolla_id
                  JOIN beneficiari be ON be.id = b.beneficiario_id
                  WHERE br2.prodotto_id = p.id
                    AND b.stato = 'consegnato'
                    AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
                    AND ${scope} AND ${sourceCondition})
                 ELSE SUM(CASE
                   WHEN mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
                     THEN abs(mv.quantita::numeric) ELSE 0 END) END), 2)
             ELSE NULL END AS percentuale_fse,
             SUM(CASE
               WHEN mv.natura_contabile = 'LEGACY'
                    AND lower(mv.unita_misura) IN ('kg', 'lt', 'l')
                 THEN abs(mv.quantita::numeric)
               ELSE -(${signedKgLt})
             END) AS kg
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      LEFT JOIN bolla_righe br ON br.id = mv.bolla_riga_id
      JOIN prodotti p ON p.id = mv.prodotto_id
      JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE mv.fondo_origine = 'FSE_PLUS'
        AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
        AND (
          mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
          OR (mv.natura_contabile = 'STORNO'
            AND original.natura_contabile = 'DISTRIBUZIONE_FINALE')
          OR (mv.natura_contabile = 'LEGACY' AND mv.tipo_movimento = 'scarico')
        )
        AND ${warehouseScope}
        AND ${authorizedFseMovement}
      GROUP BY p.id, p.nome, mv.unita_misura
      ORDER BY abs(SUM(CASE
        WHEN mv.natura_contabile = 'LEGACY' THEN abs(mv.quantita::numeric)
        ELSE -(${signedQuantity}) END)) DESC, p.nome
    `),
    rows<Record<string, unknown>>(sql`
      SELECT CASE
               WHEN COALESCE(mv.canale_operativo, original.canale_operativo) = 'RITIRO_SEDE' THEN 'PACCHI'
               WHEN COALESCE(mv.canale_operativo, original.canale_operativo) = 'UDS_STRADA' THEN 'STRADA'
               ELSE COALESCE(mv.canale_operativo, original.canale_operativo, 'NON_CLASSIFICATO')
             END AS canale,
             COUNT(DISTINCT COALESCE(
               mv.operazione_distribuzione_id,
               original.operazione_distribuzione_id
             )) AS documenti,
             NULL::int AS nuclei
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE mv.fondo_origine = 'FSE_PLUS'
        AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
        AND ${warehouseScope}
        AND ${authorizedFseMovement}
        AND (mv.operazione_distribuzione_id IS NOT NULL
          OR original.operazione_distribuzione_id IS NOT NULL)
      GROUP BY 1 ORDER BY documenti DESC, canale
    `),
    rows<Record<string, unknown>>(sql`
      SELECT CASE
               WHEN COALESCE(mv.canale_operativo, original.canale_operativo) = 'RITIRO_SEDE' THEN 'PACCHI'
               WHEN COALESCE(mv.canale_operativo, original.canale_operativo) = 'UDS_STRADA' THEN 'STRADA'
               ELSE COALESCE(mv.canale_operativo, original.canale_operativo, 'NON_CLASSIFICATO')
             END AS canale,
             mv.unita_misura,
             SUM(${signedQuantity}) AS quantita
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE mv.fondo_origine = 'FSE_PLUS'
        AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
        AND ${warehouseScope}
        AND ${authorizedFseMovement}
        AND (mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
          OR (mv.natura_contabile = 'STORNO'
            AND original.natura_contabile = 'DISTRIBUZIONE_FINALE'))
      GROUP BY 1, mv.unita_misura ORDER BY canale, mv.unita_misura
    `),
    rows<Record<string, unknown>>(sql`
      WITH famiglie AS (
        SELECT DISTINCT b.beneficiario_id
        FROM movimenti mv LEFT JOIN lotti l ON l.id = mv.lotto_id
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id
        JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND mv.fondo_origine = 'FSE_PLUS' AND b.stato = 'consegnato'
          AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a} AND ${scope}
          AND ${sourceCondition}
      ), persone AS (
        SELECT be.id::text AS persona_key, be.sesso, be.data_nascita,
               be.fascia_eta_presunta, be.area_provenienza
        FROM famiglie f JOIN beneficiari be ON be.id = f.beneficiario_id
        UNION ALL
        SELECT 'n-' || nf.id::text, nf.sesso, nf.data_nascita, NULL, be.area_provenienza
        FROM famiglie f JOIN nucleo_familiare nf ON nf.beneficiario_id = f.beneficiario_id
        JOIN beneficiari be ON be.id = f.beneficiario_id
      )
      SELECT (SELECT COUNT(*) FROM famiglie) AS nuclei,
             COUNT(*) AS persone,
             COUNT(*) FILTER (WHERE area_provenienza = 'UE') AS area_ue,
             COUNT(*) FILTER (WHERE area_provenienza = 'Extra-UE') AS area_extra_ue
      FROM persone
    `),
    rows<Record<string, unknown>>(sql`
      WITH famiglie AS (
        SELECT DISTINCT b.beneficiario_id
        FROM movimenti mv LEFT JOIN lotti l ON l.id = mv.lotto_id
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND mv.fondo_origine = 'FSE_PLUS' AND b.stato = 'consegnato'
          AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a} AND ${scope}
          AND ${sourceCondition}
      ), persone_base AS (
        SELECT be.sesso, be.data_nascita, be.fascia_eta_presunta
        FROM famiglie f JOIN beneficiari be ON be.id = f.beneficiario_id
        UNION ALL
        SELECT nf.sesso, nf.data_nascita, NULL
        FROM famiglie f JOIN nucleo_familiare nf ON nf.beneficiario_id = f.beneficiario_id
      ), persone AS (
        SELECT ${ageBand} AS fascia FROM persone_base persone
      )
      SELECT fascia, COUNT(*) AS persone FROM persone
      GROUP BY fascia ORDER BY CASE fascia
        WHEN '0_17' THEN 1 WHEN '18_29' THEN 2 WHEN '30_64' THEN 3
        WHEN '65_plus' THEN 4 ELSE 5 END
    `),
    rows<Record<string, unknown>>(sql`
      WITH famiglie AS (
        SELECT DISTINCT b.beneficiario_id
        FROM movimenti mv LEFT JOIN lotti l ON l.id = mv.lotto_id
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND mv.fondo_origine = 'FSE_PLUS' AND b.stato = 'consegnato'
          AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a} AND ${scope}
          AND ${sourceCondition}
      ), persone AS (
        SELECT be.sesso FROM famiglie f JOIN beneficiari be ON be.id = f.beneficiario_id
        UNION ALL
        SELECT nf.sesso FROM famiglie f JOIN nucleo_familiare nf ON nf.beneficiario_id = f.beneficiario_id
      )
      SELECT COALESCE(NULLIF(trim(sesso), ''), 'non_determinato') AS sesso,
             COUNT(*) AS persone FROM persone GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      WITH famiglie AS (
        SELECT DISTINCT b.beneficiario_id
        FROM movimenti mv LEFT JOIN lotti l ON l.id = mv.lotto_id
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND mv.fondo_origine = 'FSE_PLUS' AND b.stato = 'consegnato'
          AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a} AND ${scope}
          AND ${sourceCondition}
      ), persone AS (
        SELECT be.sesso, be.data_nascita, be.fascia_eta_presunta
        FROM famiglie f JOIN beneficiari be ON be.id = f.beneficiario_id
        UNION ALL
        SELECT nf.sesso, nf.data_nascita, NULL
        FROM famiglie f JOIN nucleo_familiare nf ON nf.beneficiario_id = f.beneficiario_id
      )
      SELECT COUNT(*) FILTER (WHERE sesso IS NULL OR trim(sesso) = '') AS sesso_mancante,
             COUNT(*) FILTER (WHERE data_nascita IS NULL AND fascia_eta_presunta IS NULL) AS eta_mancante,
             COUNT(*) FILTER (WHERE data_nascita IS NULL AND fascia_eta_presunta IS NOT NULL) AS fascia_presunta
      FROM persone
    `),
    rows<Record<string, unknown>>(sql`
      SELECT
        ${
          sources.pacchi
            ? sql`(SELECT COUNT(DISTINCT b.id) FROM bolle b
          JOIN beneficiari be ON be.id = b.beneficiario_id
          WHERE b.stato = 'consegnato' AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
            AND ${scope}
            AND NOT EXISTS (SELECT 1 FROM spese_emporio source_se
              WHERE source_se.bolla_id = b.id AND source_se.stato_spesa = 'chiusa'))`
            : sql`NULL`
        } AS pacchi,
        ${
          sources.mensa
            ? sql`(SELECT COUNT(*) FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
          JOIN magazzini mg ON mg.id = m.magazzino_id
          WHERE mp.data_servizio BETWEEN ${filters.da} AND ${filters.a}
            AND ${andSql(reportScope(filters, { areaOperativa: sql`m.area_operativa_id`, centro: sql`mg.centro_ascolto_id` }))})`
            : sql`NULL`
        } AS pasti
    `),
    rows<Record<string, unknown>>(sql`
      WITH fse_period AS (
        SELECT mv.*, original.natura_contabile AS original_nature,
               COALESCE(mv.operazione_distribuzione_id,
                 original.operazione_distribuzione_id) AS effective_operation_id,
               ${signedQuantity} AS signed_quantity
        FROM movimenti mv
        LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
        JOIN magazzini mg ON mg.id = mv.magazzino_id
        WHERE mv.fondo_origine = 'FSE_PLUS'
          AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
          AND ${warehouseScope}
      ), fse_events AS (
        SELECT op.id,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.numero_pacchi END AS numero_pacchi,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.numero_pasti END AS numero_pasti,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.indigenti_saltuari END AS indigenti_saltuari,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.indigenti_continuativi END AS indigenti_continuativi
        FROM fse_period mv JOIN operazioni_distribuzione_magazzino op
          ON op.id = mv.effective_operation_id
        GROUP BY op.id, op.numero_pacchi, op.numero_pasti,
          op.indigenti_saltuari, op.indigenti_continuativi
      )
      SELECT
        COALESCE((SELECT SUM(CASE WHEN lower(p.unita_misura)='pz' THEN l.quantita_residua::numeric
          WHEN l.fattore_kg_lt_pezzo IS NOT NULL THEN l.quantita_residua::numeric/l.fattore_kg_lt_pezzo::numeric ELSE 0 END)
          FROM lotti l JOIN prodotti p ON p.id=l.prodotto_id JOIN magazzini mg ON mg.id=l.magazzino_id
          WHERE l.fondo_origine='FSE_PLUS' AND ${warehouseScope}),0)::text AS corrente_pezzi,
        COALESCE((SELECT SUM(CASE WHEN lower(p.unita_misura) IN ('kg','lt','l') THEN l.quantita_residua::numeric
          WHEN lower(p.unita_misura)='pz' AND l.fattore_kg_lt_pezzo IS NOT NULL THEN l.quantita_residua::numeric*l.fattore_kg_lt_pezzo::numeric ELSE 0 END)
          FROM lotti l JOIN prodotti p ON p.id=l.prodotto_id JOIN magazzini mg ON mg.id=l.magazzino_id
          WHERE l.fondo_origine='FSE_PLUS' AND ${warehouseScope}),0)::text AS corrente_kg_lt,
        COALESCE((SELECT SUM(${signedPieces})
          FROM movimenti mv LEFT JOIN movimenti original ON original.id=mv.movimento_origine_id
          JOIN magazzini mg ON mg.id=mv.magazzino_id
          WHERE mv.fondo_origine='FSE_PLUS' AND mv.data_movimento<=${filters.a} AND ${warehouseScope}),0)::text AS asof_pezzi,
        COALESCE((SELECT SUM(${signedKgLt})
          FROM movimenti mv LEFT JOIN movimenti original ON original.id=mv.movimento_origine_id
          JOIN magazzini mg ON mg.id=mv.magazzino_id
          WHERE mv.fondo_origine='FSE_PLUS' AND mv.data_movimento<=${filters.a} AND ${warehouseScope}),0)::text AS asof_kg_lt,
        count(*) FILTER (WHERE natura_contabile='CARICO') AS carichi,
        count(*) FILTER (WHERE natura_contabile='DISTRIBUZIONE_FINALE') AS distribuzioni_lorde,
        count(*) FILTER (WHERE natura_contabile='STORNO') AS storni,
        COALESCE(SUM(abs(quantita_pezzi::numeric)) FILTER (WHERE natura_contabile='DISTRIBUZIONE_FINALE'),0)::text AS distribuzioni_lorde_pezzi,
        COALESCE(SUM(abs(quantita_kg_lt::numeric)) FILTER (WHERE natura_contabile='DISTRIBUZIONE_FINALE'),0)::text AS distribuzioni_lorde_kg_lt,
        COALESCE(SUM(abs(quantita_pezzi::numeric)) FILTER (WHERE natura_contabile='STORNO' AND original_nature='DISTRIBUZIONE_FINALE'),0)::text AS storni_distribuzioni_pezzi,
        COALESCE(SUM(abs(quantita_kg_lt::numeric)) FILTER (WHERE natura_contabile='STORNO' AND original_nature='DISTRIBUZIONE_FINALE'),0)::text AS storni_distribuzioni_kg_lt,
        COALESCE(SUM(${signedMovementSql(sql`quantita_pezzi`, sql`natura_contabile`, sql`original_nature`)}) FILTER (WHERE natura_contabile IN ('DISTRIBUZIONE_FINALE','STORNO')),0)::text AS distribuzioni_nette_pezzi,
        COALESCE(SUM(${signedMovementSql(sql`quantita_kg_lt`, sql`natura_contabile`, sql`original_nature`)}) FILTER (WHERE natura_contabile IN ('DISTRIBUZIONE_FINALE','STORNO')),0)::text AS distribuzioni_nette_kg_lt,
        count(*) FILTER (WHERE natura_contabile='RESO') AS resi,
        count(*) FILTER (WHERE natura_contabile IN ('RETTIFICA_POSITIVA','RETTIFICA_NEGATIVA','SCARTO')) AS rettifiche,
        (SELECT count(*) FROM fse_events) AS eventi,
        (SELECT COALESCE(sum(numero_pacchi),0) FROM fse_events) AS pacchi,
        (SELECT COALESCE(sum(numero_pasti),0) FROM fse_events) AS pasti,
        (SELECT COALESCE(sum(indigenti_saltuari),0) FROM fse_events) AS saltuari,
        (SELECT COALESCE(sum(indigenti_continuativi),0) FROM fse_events) AS continuativi,
        (SELECT count(*) FROM fse_events
          WHERE indigenti_saltuari IS NOT NULL
             OR indigenti_continuativi IS NOT NULL) AS eventi_con_statistiche,
        count(*) FILTER (WHERE natura_contabile='DISTRIBUZIONE_FINALE' AND operazione_distribuzione_id IS NULL) AS bloccati,
        (SELECT count(*) FROM rilevazioni_monitoraggio_fse rm JOIN magazzini mg ON mg.id=rm.magazzino_id
          WHERE rm.data_riferimento BETWEEN ${filters.da} AND ${filters.a} AND ${warehouseScope}) AS rilevazioni_monitoraggio
      FROM fse_period
    `),
    rows<Record<string, unknown>>(sql`
      SELECT
        (SELECT count(DISTINCT COALESCE(
            'DISTRIBUZIONE:' || mv.operazione_distribuzione_id::text,
            'MOVIMENTO:' || mv.id::text
          ))
         FROM movimenti mv
         JOIN magazzini mg ON mg.id = mv.magazzino_id
         WHERE mv.fondo_origine = 'FSE_PLUS'
           AND mv.data_movimento <= ${filters.a}
           AND ${warehouseScope}
           AND NOT EXISTS (
             SELECT 1 FROM esportazioni_fse_eventi ee
             JOIN esportazioni_fse ex ON ex.id = ee.esportazione_id
             WHERE ee.event_key = COALESCE(
               'DISTRIBUZIONE:' || mv.operazione_distribuzione_id::text,
               'MOVIMENTO:' || mv.id::text
             )
               AND ee.active_coverage = true
               AND ex.coverage_purpose = 'ADMINISTRATIVE'
               AND ex.stato IN ('PRONTA_PER_INSERIMENTO_MANUALE', 'INSERITA_MANUALMENTE')
           )) AS da_rendicontare,
        (SELECT count(*) FROM esportazioni_fse_eventi ee
         JOIN esportazioni_fse ex ON ex.id = ee.esportazione_id
         JOIN magazzini mg ON mg.id = ex.magazzino_id
         WHERE ee.active_coverage = true
           AND ee.administrative_status = 'IN_ESPORTAZIONE'
           AND ex.data_a <= ${filters.a}
           AND ${warehouseScope}) AS in_esportazione,
        (SELECT count(*) FROM esportazioni_fse_eventi ee
         JOIN esportazioni_fse ex ON ex.id = ee.esportazione_id
         JOIN magazzini mg ON mg.id = ex.magazzino_id
         WHERE ex.stato = 'INSERITA_MANUALMENTE'
           AND ex.data_a <= ${filters.a}
           AND ${warehouseScope}) AS inseriti_manualmente,
        (SELECT count(*) FROM esportazioni_fse_eventi ee
         JOIN esportazioni_fse ex ON ex.id = ee.esportazione_id
         JOIN magazzini mg ON mg.id = ex.magazzino_id
         WHERE ee.arretrato = true AND ee.active_coverage = true
           AND ex.data_a <= ${filters.a} AND ${warehouseScope}) AS arretrati,
        (SELECT max(ex.data_creazione) FROM esportazioni_fse ex
         JOIN magazzini mg ON mg.id = ex.magazzino_id
         WHERE ex.data_a <= ${filters.a} AND ${warehouseScope}) AS ultima_esportazione,
        (SELECT max(ai.data_conferma) FROM importazioni_agea ai
         JOIN magazzini mg ON mg.id = ai.magazzino_id
         WHERE ai.data_riferimento <= ${filters.a} AND ${warehouseScope}) AS ultima_importazione,
        (SELECT max(rf.data_creazione) FROM riconciliazioni_fse rf
         JOIN magazzini mg ON mg.id = rf.magazzino_id
         WHERE rf.data_riferimento <= ${filters.a} AND ${warehouseScope}) AS ultima_riconciliazione,
        (SELECT count(*) FROM riconciliazioni_fse_righe rr
         JOIN riconciliazioni_fse rf ON rf.id = rr.riconciliazione_id
         JOIN magazzini mg ON mg.id = rf.magazzino_id
         WHERE rf.data_riferimento <= ${filters.a}
           AND rr.status = 'RICONCILIATA_ESATTA' AND ${warehouseScope}) AS righe_riconciliate,
        (SELECT count(*) FROM riconciliazioni_fse_righe rr
         JOIN riconciliazioni_fse rf ON rf.id = rr.riconciliazione_id
         JOIN magazzini mg ON mg.id = rf.magazzino_id
         WHERE rf.data_riferimento <= ${filters.a}
           AND rr.blocking = true
           AND rf.stato IN ('CALCOLATA', 'DA_RIVEDERE')
           AND ${warehouseScope}) AS scostamenti_aperti
    `),
  ]);
  const persons = people[0] ?? {};
  const dq = qualityRows[0] ?? {};
  const pp = packageMeals[0] ?? {};
  const ac = accountingRows[0] ?? {};
  const administrative = administrativeRows[0] ?? {};
  const distinctProducts = new Set(
    products.map((row) => number(row.prodotto_id)),
  ).size;
  const kg = products.reduce(
    (sum, row) => sum + (row.kg == null ? 0 : number(row.kg)),
    0,
  );
  const unconvertible = products.filter((row) => row.kg == null).length;

  const availabilityRows = [
    [
      "Prodotti e quantità FSE+",
      "OK",
      "Movimenti",
      "Lo snapshot Fondo del Movimento è autorevole",
    ],
    [
      "Nuclei e persone raggiunte",
      "OK",
      "Bolle e nucleo familiare",
      "Titolare più membri registrati",
    ],
    ["Sesso", "DERIVABILE", "Anagrafica", "Con controllo dei valori mancanti"],
    [
      "Fasce d'età",
      "DERIVABILE",
      "Data nascita/fascia presunta",
      `Reference date ${filters.a}`,
    ],
    [
      "Origine straniera/minoranze",
      "MANCANTE",
      "Nessuna fonte equivalente",
      "areaProvenienza non equivale alla definizione SIFEAD",
    ],
    [
      "Disabilità individuale",
      "MANCANTE",
      "Solo aggregato familiare",
      "numDisabili non identifica persone",
    ],
    [
      "Cittadini Paesi Terzi",
      "MANCANTE",
      "Nessuna classificazione normativa",
      "Extra-UE non viene reinterpretato",
    ],
    [
      "Senzatetto/esclusione abitativa",
      "MANCANTE",
      "Nessun campo strutturato",
      "Le note libere non vengono analizzate",
    ],
    [
      "Indicatori continuativo/saltuario",
      number(ac.rilevazioni_monitoraggio) > 0 ? "DISPONIBILE" : "MANCANTE",
      "Rilevazioni mensili FSE+ versionate",
      number(ac.rilevazioni_monitoraggio) > 0
        ? "Valori strutturati con fonte e completezza esplicite"
        : "Nessuna rilevazione strutturata nel periodo",
    ],
    [
      "Misure di accompagnamento FSE+",
      "MANCANTE",
      "Tipi intervento non mappati FSE+",
      "Serve una decisione funzionale di mapping",
    ],
    [
      "Prodotti FSE+ nei pasti Mensa",
      "MANCANTE",
      "Pasto non collegato a righe prodotto",
      "I trasferimenti alla Mensa non provano il consumo nel pasto",
    ],
  ];
  const eventStatisticsAvailable = number(ac.eventi_con_statistiche) > 0;
  const monitoringAvailable = number(ac.rilevazioni_monitoraggio) > 0;
  const statisticsAvailability = eventStatisticsAvailable
    ? "DISPONIBILE_DA_EVENTO"
    : monitoringAvailable
      ? "DISPONIBILE_DA_RILEVAZIONE_MENSILE"
      : "MANCANTE";
  const missingSifeadDimensions = availabilityRows.filter(
    ([, availability]) => availability === "MANCANTE",
  ).length;

  return dashboard({
    section: "fse-plus",
    filters,
    kpi: [
      kpi(
        "giacenzaFseCorrentePezzi",
        number(ac.corrente_pezzi),
        "pieces",
        null,
        "ok",
        String(ac.corrente_pezzi ?? "0"),
      ),
      kpi(
        "giacenzaFseCorrenteKgLt",
        number(ac.corrente_kg_lt),
        "kgLt",
        null,
        "ok",
        String(ac.corrente_kg_lt ?? "0"),
      ),
      kpi(
        "giacenzaFseAsOfPezzi",
        number(ac.asof_pezzi),
        "pieces",
        null,
        "ok",
        String(ac.asof_pezzi ?? "0"),
      ),
      kpi(
        "giacenzaFseAsOfKgLt",
        number(ac.asof_kg_lt),
        "kgLt",
        null,
        "ok",
        String(ac.asof_kg_lt ?? "0"),
      ),
      kpi("carichiFse", number(ac.carichi)),
      kpi("distribuzioniFseLorde", number(ac.distribuzioni_lorde)),
      kpi("storniFse", number(ac.storni)),
      kpi(
        "distribuzioniFseLordePezzi",
        number(ac.distribuzioni_lorde_pezzi),
        "pieces",
      ),
      kpi(
        "distribuzioniFseLordeKgLt",
        number(ac.distribuzioni_lorde_kg_lt),
        "kgLt",
      ),
      kpi(
        "storniDistribuzioniPezzi",
        number(ac.storni_distribuzioni_pezzi),
        "pieces",
      ),
      kpi(
        "storniDistribuzioniKgLt",
        number(ac.storni_distribuzioni_kg_lt),
        "kgLt",
      ),
      kpi(
        "distribuzioniFseNettePezzi",
        Math.abs(number(ac.distribuzioni_nette_pezzi)),
        "pieces",
      ),
      kpi(
        "distribuzioniFseNetteKgLt",
        Math.abs(number(ac.distribuzioni_nette_kg_lt)),
        "kgLt",
      ),
      kpi("eventiDistribuzione", number(ac.eventi)),
      kpi("saltuari", number(ac.saltuari)),
      kpi("continuativi", number(ac.continuativi)),
      kpi("resiOpc", number(ac.resi)),
      kpi("modificheGiacenza", number(ac.rettifiche)),
      kpi("eventiBloccati", number(ac.bloccati)),
      kpi("rilevazioniMonitoraggio", number(ac.rilevazioni_monitoraggio)),
      kpi("eventiDaRendicontare", number(administrative.da_rendicontare)),
      kpi("eventiInEsportazione", number(administrative.in_esportazione)),
      kpi(
        "eventiInseritiManualmente",
        number(administrative.inseriti_manualmente),
      ),
      kpi("eventiArretrati", number(administrative.arretrati)),
      kpi("righeRiconciliate", number(administrative.righe_riconciliate)),
      kpi("scostamentiAperti", number(administrative.scostamenti_aperti)),
      kpi(
        "prodottiFseDistinti",
        distinctProducts,
        "count",
        "prodottiFseDistinti",
      ),
      kpi("kgCalcolabili", kg, "kgLt"),
      kpi(
        "nucleiRaggiunti",
        number(persons.nuclei),
        "count",
        "nucleiRaggiunti",
      ),
      kpi(
        "personeRaggiunte",
        number(persons.persone),
        "count",
        "personeRaggiunte",
      ),
      ...(sources.pacchi ? [kpi("pacchiDistribuiti", number(pp.pacchi))] : []),
      ...(sources.mensa ? [kpi("pastiDistribuiti", number(pp.pasti))] : []),
    ],
    series: [
      {
        key: "canali",
        points: channels.map((r) => ({
          label: String(r.canale),
          value: number(r.documenti),
          secondaryValue: r.nuclei == null ? null : number(r.nuclei),
        })),
      },
    ],
    tables: [
      {
        key: "01_Prodotti_FSE",
        columns: [
          "prodottoId",
          "prodottoNome",
          "unitaMisura",
          "quantitaFse",
          "quantitaTotale",
          "percentualeFse",
          "kg",
        ],
        rows: products.map((r) => ({
          prodottoId: number(r.prodotto_id),
          prodottoNome: String(r.prodotto_nome),
          unitaMisura: String(r.unita_misura),
          quantitaFse: number(r.quantita_fse),
          quantitaTotale: number(r.quantita_totale),
          percentualeFse:
            r.percentuale_fse == null ? null : number(r.percentuale_fse),
          kg: r.kg == null ? null : number(r.kg),
        })),
      },
      {
        key: "02_Continuativi",
        columns: ["stato", "nota"],
        rows: [
          {
            stato: statisticsAvailability,
            nota:
              statisticsAvailability === "MANCANTE"
                ? "Nessuna statistica evento o rilevazione mensile disponibile"
                : "Aggregato disponibile; non identifica persone uniche",
          },
        ],
      },
      {
        key: "03_Saltuari_Mensa",
        columns: ["stato", "nota"],
        rows: [
          {
            stato: statisticsAvailability,
            nota: "Statistiche aggregate evento/rilevazione; nessuna persona anonima viene deduplicata",
          },
        ],
      },
      {
        key: "04_Saltuari_Pacchi",
        columns: ["stato", "nota"],
        rows: [
          {
            stato: statisticsAvailability,
            nota: "Statistiche aggregate evento/rilevazione; non anagrafica individuale",
          },
        ],
      },
      {
        key: "05_Saltuari_Strada",
        columns: ["stato", "nota"],
        rows: [
          {
            stato: statisticsAvailability,
            nota: "Canale STRADA derivato da UDS_STRADA; valori aggregati se rilevati",
          },
        ],
      },
      {
        key: "06_Pacchi_Pasti",
        columns: ["pacchi", "pasti"],
        rows: [
          {
            pacchi: pp.pacchi == null ? null : number(pp.pacchi),
            pasti: pp.pasti == null ? null : number(pp.pasti),
          },
        ],
      },
      {
        key: "07_Misure_Accompagnamento",
        columns: ["stato", "nota"],
        rows: [
          {
            stato: "MANCANTE",
            nota: "Tipologie intervento non mappate a misure FSE+",
          },
        ],
      },
      {
        key: "fasceEta",
        columns: ["fascia", "persone"],
        rows: ageRows.map((r) => ({
          fascia: String(r.fascia),
          persone: number(r.persone),
        })),
      },
      {
        key: "sesso",
        columns: ["sesso", "persone"],
        rows: sexRows.map((r) => ({
          sesso: String(r.sesso),
          persone: number(r.persone),
        })),
      },
      {
        key: "canali",
        columns: ["canale", "documenti", "nuclei"],
        rows: channels.map((r) => ({
          canale: String(r.canale),
          documenti: number(r.documenti),
          nuclei: r.nuclei == null ? null : number(r.nuclei),
        })),
      },
      {
        key: "quantitaPerCanaleUnita",
        columns: ["canale", "unitaMisura", "quantita"],
        rows: channelQuantities.map((r) => ({
          canale: String(r.canale),
          unitaMisura: String(r.unita_misura),
          quantita: number(r.quantita),
        })),
      },
      {
        key: "disponibilitaSifead",
        columns: ["campo", "disponibilita", "fonte", "note"],
        rows: availabilityRows.map(([campo, disponibilita, fonte, note]) => ({
          campo,
          disponibilita,
          fonte,
          note,
        })),
      },
    ],
    quality: [
      quality(
        "sessoMancante",
        number(dq.sesso_mancante),
        number(dq.sesso_mancante) ? "missing" : "ok",
      ),
      quality(
        "dataNascitaMancante",
        number(dq.eta_mancante),
        number(dq.eta_mancante) ? "missing" : "ok",
      ),
      quality(
        "fasciaEtaPresuntaUsata",
        number(dq.fascia_presunta),
        number(dq.fascia_presunta) ? "derivable" : "ok",
      ),
      quality(
        "unitaPesoNonNormalizzabile",
        unconvertible,
        unconvertible ? "missing" : "ok",
        "Solo le quantità già espresse in kg confluiscono nei kg calcolabili.",
      ),
      quality(
        "dimensioniSifeadMancanti",
        missingSifeadDimensions,
        missingSifeadDimensions ? "missing" : "ok",
        "I campi mancanti sono esposti come non disponibili, mai come zero.",
      ),
    ],
    definitions: [
      "La provenienza FSE+ è determinata esclusivamente dallo snapshot Fondo del Movimento.",
      "Una persona raggiunta è il titolare o un membro registrato di un nucleo con distribuzione FSE+.",
      `Le fasce d'età sono valutate alla data finale ${filters.a}.`,
      "Le celle SIFEAD non supportate dal modello restano MANCANTI e non assumono valore zero.",
      "Le sorgenti FSE+ sono incluse solo quando modulo, area e permessi del chiamante lo consentono.",
      "I canali comprendono Pacchi/Ritiro sede, Domiciliare, Emporio, Mensa e UDS Strada dal ledger canonico; i nuclei anonimi restano null e le quantità restano separate per unità di misura.",
      `Ultima esportazione: ${String(administrative.ultima_esportazione ?? "mai")}; ultima importazione AGEA: ${String(administrative.ultima_importazione ?? "mai")}; ultima riconciliazione: ${String(administrative.ultima_riconciliazione ?? "mai")}.`,
    ],
  });
}
