import { sql, type SQL } from "drizzle-orm";
import { isModuloAttivo } from "../featureFlags";
import type { ReportFilters } from "./types";
import { andSql, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality, text } from "./shared";
import { signedMovementSql } from "../fseAccounting";
import {
  fseCanonicalPeriodCondition,
  fseDistributionNatureCondition,
  fseNetDistributedQuantity,
  fseSignedQuantity,
} from "./fseCanonicalFacts";
import { authoritativeSnapshotOrderForAliasS } from "./fseSnapshotOrder";

function fseScope(filters: ReportFilters) {
  return andSql(
    reportScope(filters, {
      areaOperativa: sql`COALESCE(b.area_operativa_id_snapshot, be.area_operativa_id)`,
      centro: sql`COALESCE(b.centro_ascolto_id_snapshot, be.centro_ascolto_id)`,
      magazzino: sql`b.magazzino_id`,
    }),
  );
}

export function fseAuthorizedMovementCondition(
  filters: ReportFilters,
  channels?: string[],
): SQL {
  const warehouseOversight = filters.callerAreas.some(
    (area) => area === "magazzino" || area === "logistica",
  );
  const allowedChannels =
    channels ??
    (filters.callerIsAdmin || warehouseOversight
      ? [
          "PACCHI",
          "RITIRO_SEDE",
          "DOMICILIARE",
          "EMPORIO",
          "MENSA",
          "UDS_STRADA",
        ]
      : [
          ...(filters.callerAreas.includes("sociale")
            ? ["PACCHI", "RITIRO_SEDE", "DOMICILIARE"]
            : []),
          ...(filters.callerAreas.includes("emporio") ? ["EMPORIO"] : []),
          ...(filters.callerAreas.includes("mensa") ? ["MENSA"] : []),
          ...(filters.callerAreas.includes("uds") ? ["UDS_STRADA"] : []),
        ]);
  const bollaScope = fseScope(filters);
  const bollaSource = fseBollaSourceCondition(filters);
  const territorialScope =
    filters.areaOperativaId == null
      ? sql`true`
      : sql`EXISTS (
        SELECT 1
        FROM operazioni_distribuzione_magazzino territory_op
        WHERE territory_op.id = COALESCE(
          mv.operazione_distribuzione_id,
          original.operazione_distribuzione_id
        )
          AND territory_op.territorio_classificazione = 'attribuito'
          AND territory_op.area_operativa_id_snapshot = ${filters.areaOperativaId}
          AND (${filters.centroAscoltoId}::integer IS NULL
            OR territory_op.centro_ascolto_id_snapshot = ${filters.centroAscoltoId})
      )`;
  return sql`(
    (mv.natura_contabile <> 'LEGACY' AND ${territorialScope} AND ${
      filters.callerIsAdmin || warehouseOversight
        ? sql`true`
        : allowedChannels.length
          ? sql`COALESCE(mv.canale_operativo, original.canale_operativo) IN (${sql.join(
              allowedChannels.map((channel) => sql`${channel}`),
              sql`, `,
            )})`
          : sql`false`
    })
    OR (mv.natura_contabile = 'LEGACY' AND ${filters.areaOperativaId == null ? sql`true` : sql`false`} AND EXISTS (
      SELECT 1 FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      WHERE b.id = mv.bolla_id AND ${bollaScope} AND ${bollaSource}
    ))
  )`;
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
  const canSuperviseWarehouse = canRead("magazzino") || canRead("logistica");
  return {
    pacchi: magazzino && bolle && (canRead("sociale") || canSuperviseWarehouse),
    emporio: emporio && (canRead("emporio") || canSuperviseWarehouse),
    mensa: mensa && (canRead("mensa") || canSuperviseWarehouse),
    uds: uds && (canRead("uds") || canSuperviseWarehouse),
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
  const warehouseScope = andSql(
    reportScope(
      filters,
      {
        areaOperativa: sql`mg.area_operativa_id`,
        centro: sql`mg.centro_ascolto_id`,
        magazzino: sql`mg.id`,
      },
      { sharedAreaOperativa: true, sharedCentro: true },
    ),
  );
  const allowedCanonicalChannels = [
    ...(sources.pacchi ? ["PACCHI", "RITIRO_SEDE", "DOMICILIARE"] : []),
    ...(sources.emporio ? ["EMPORIO"] : []),
    ...(sources.mensa ? ["MENSA"] : []),
    ...(sources.uds ? ["UDS_STRADA"] : []),
  ];
  const authorizedFseMovement = fseAuthorizedMovementCondition(
    filters,
    allowedCanonicalChannels,
  );
  const allowedCanonicalChannelCondition = allowedCanonicalChannels.length
    ? sql`COALESCE(mv.canale_operativo, original.canale_operativo) IN (${sql.join(
        allowedCanonicalChannels.map((channel) => sql`${channel}`),
        sql`, `,
      )})`
    : sql`false`;
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
  const signedQuantity = fseSignedQuantity(sql`mv.quantita`);
  const distributedQuantity = fseNetDistributedQuantity(sql`mv.quantita`);
  const distributedKgLt = sql`CASE WHEN mv.natura_contabile = 'LEGACY'
    AND lower(mv.unita_misura) IN ('kg', 'lt', 'l')
    THEN abs(mv.quantita::numeric) ELSE -(${signedKgLt}) END`;
  const beneficiaryProfilesCte = sql`
    WITH movimenti_famiglie AS (
      SELECT b.beneficiario_id,
             COALESCE(
               mv.operazione_distribuzione_id,
               original.operazione_distribuzione_id,
               -mv.id
             ) AS evento_id,
             SUM(${distributedQuantity}) AS quantita_netta
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      JOIN magazzini mg ON mg.id = mv.magazzino_id
      LEFT JOIN bolla_righe br_famiglia ON br_famiglia.id = COALESCE(
        mv.bolla_riga_id,
        original.bolla_riga_id
      )
      JOIN bolle b ON b.id = COALESCE(
        mv.bolla_id,
        original.bolla_id,
        br_famiglia.bolla_id
      )
      JOIN beneficiari be ON be.id = b.beneficiario_id
      WHERE mv.fondo_origine = 'FSE_PLUS'
        AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
        AND ${fseDistributionNatureCondition}
        AND ${warehouseScope}
        AND ${authorizedFseMovement}
        AND ${fseScope(filters)}
      GROUP BY b.beneficiario_id, evento_id
    ), famiglie AS (
      SELECT DISTINCT beneficiario_id
      FROM movimenti_famiglie
      WHERE quantita_netta <> 0
    ), profili AS (
      SELECT f.beneficiario_id, fs.*
      FROM famiglie f
      LEFT JOIN LATERAL (
        SELECT s.* FROM fse_fascicoli_sociali_snapshot s
        WHERE s.beneficiario_id = f.beneficiario_id
          AND s.data_riferimento <= ${filters.a}
        ORDER BY ${authoritativeSnapshotOrderForAliasS}
        LIMIT 1
      ) fs ON true
    )`;
  const [
    products,
    channels,
    channelQuantities,
    people,
    ageRows,
    sexRows,
    qualityRows,
    accountingRows,
    administrativeRows,
  ] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT p.id AS prodotto_id, p.nome AS prodotto_nome, mv.unita_misura,
             SUM(${distributedQuantity}) FILTER (WHERE mv.fondo_origine = 'FSE_PLUS') AS quantita_fse,
             SUM(${distributedQuantity}) AS quantita_totale,
             round(
               SUM(${distributedQuantity}) FILTER (WHERE mv.fondo_origine = 'FSE_PLUS') * 100
               / NULLIF(SUM(${distributedQuantity}), 0), 2
             ) AS percentuale_fse,
             SUM(${distributedKgLt}) FILTER (WHERE mv.fondo_origine = 'FSE_PLUS') AS kg
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      LEFT JOIN bolla_righe br ON br.id = mv.bolla_riga_id
      JOIN prodotti p ON p.id = mv.prodotto_id
      JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
        AND ${fseDistributionNatureCondition}
        AND ${warehouseScope}
        AND ${authorizedFseMovement}
      GROUP BY p.id, p.nome, mv.unita_misura
      HAVING COALESCE(SUM(${distributedQuantity}) FILTER (WHERE mv.fondo_origine = 'FSE_PLUS'), 0) <> 0
      ORDER BY abs(SUM(${distributedQuantity}) FILTER (WHERE mv.fondo_origine = 'FSE_PLUS')) DESC, p.nome
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(
               mv.canale_operativo,
               original.canale_operativo,
               'NON_CLASSIFICATO'
             ) AS canale,
             COUNT(DISTINCT COALESCE(
               mv.operazione_distribuzione_id,
               original.operazione_distribuzione_id
             )) AS documenti,
             NULL::int AS nuclei
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE ${fseCanonicalPeriodCondition(filters, warehouseScope, authorizedFseMovement)}
        AND (mv.operazione_distribuzione_id IS NOT NULL
          OR original.operazione_distribuzione_id IS NOT NULL)
      GROUP BY 1 ORDER BY documenti DESC, canale
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(
               mv.canale_operativo,
               original.canale_operativo,
               'NON_CLASSIFICATO'
             ) AS canale,
             mv.unita_misura,
             SUM(${distributedQuantity}) AS quantita
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      JOIN magazzini mg ON mg.id = mv.magazzino_id
      WHERE mv.fondo_origine = 'FSE_PLUS'
        AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
        AND ${warehouseScope}
        AND ${authorizedFseMovement}
        AND ${fseDistributionNatureCondition}
      GROUP BY 1, mv.unita_misura ORDER BY canale, mv.unita_misura
    `),
    rows<Record<string, unknown>>(sql`${beneficiaryProfilesCte}
      SELECT COUNT(*) AS nuclei,
             SUM(numero_componenti) AS persone,
             SUM(origine_straniera_minoranze) AS origine_straniera_minoranze,
             SUM(persone_disabilita) AS persone_disabilita,
             SUM(cittadini_paesi_terzi) AS cittadini_paesi_terzi,
             SUM(senza_tetto_esclusione_abitativa) AS esclusione_abitativa,
             SUM(donne + uomini) FILTER (
               WHERE donne IS NOT NULL AND uomini IS NOT NULL
             ) AS persone_sesso_note,
             SUM(eta_0_17 + eta_18_29 + eta_30_64 + eta_65_plus) FILTER (
               WHERE eta_0_17 IS NOT NULL AND eta_18_29 IS NOT NULL
                 AND eta_30_64 IS NOT NULL AND eta_65_plus IS NOT NULL
             ) AS persone_eta_note,
             COUNT(*) FILTER (WHERE id IS NOT NULL) AS con_snapshot,
             COUNT(*) FILTER (WHERE id IS NULL) AS senza_snapshot,
             COUNT(*) FILTER (WHERE numero_componenti IS NOT NULL) AS copertura_numero_componenti,
             COUNT(*) FILTER (WHERE donne IS NOT NULL AND uomini IS NOT NULL) AS copertura_sesso,
             COUNT(*) FILTER (WHERE eta_0_17 IS NOT NULL AND eta_18_29 IS NOT NULL
               AND eta_30_64 IS NOT NULL AND eta_65_plus IS NOT NULL) AS copertura_eta,
             COUNT(*) FILTER (WHERE origine_straniera_minoranze IS NOT NULL) AS copertura_origine,
             COUNT(*) FILTER (WHERE persone_disabilita IS NOT NULL) AS copertura_disabilita,
             COUNT(*) FILTER (WHERE cittadini_paesi_terzi IS NOT NULL) AS copertura_paesi_terzi,
             COUNT(*) FILTER (WHERE senza_tetto_esclusione_abitativa IS NOT NULL) AS copertura_esclusione
      FROM profili
    `),
    rows<Record<string, unknown>>(sql`${beneficiaryProfilesCte}, fasce AS (
      SELECT v.fascia, v.persone FROM profili p
      CROSS JOIN LATERAL (VALUES
        ('0_17', p.eta_0_17), ('18_29', p.eta_18_29),
        ('30_64', p.eta_30_64), ('65_plus', p.eta_65_plus)
      ) v(fascia, persone)
      WHERE p.id IS NOT NULL AND v.persone IS NOT NULL
    )
      SELECT fascia, SUM(persone) AS persone FROM fasce GROUP BY fascia
      ORDER BY CASE fascia WHEN '0_17' THEN 1 WHEN '18_29' THEN 2
        WHEN '30_64' THEN 3 WHEN '65_plus' THEN 4 END
    `),
    rows<Record<string, unknown>>(sql`${beneficiaryProfilesCte}, sessi AS (
      SELECT v.sesso, v.persone FROM profili p
      CROSS JOIN LATERAL (VALUES ('F', p.donne), ('M', p.uomini)) v(sesso, persone)
      WHERE p.id IS NOT NULL AND v.persone IS NOT NULL
    )
      SELECT sesso, SUM(persone) AS persone FROM sessi GROUP BY sesso ORDER BY sesso
    `),
    rows<Record<string, unknown>>(sql`${beneficiaryProfilesCte}
      SELECT COUNT(*) FILTER (WHERE id IS NULL) AS snapshot_mancante,
             COUNT(*) FILTER (WHERE id IS NOT NULL AND (
               numero_componenti IS NULL OR donne IS NULL OR uomini IS NULL
               OR eta_0_17 IS NULL OR eta_18_29 IS NULL OR eta_30_64 IS NULL OR eta_65_plus IS NULL
             )) AS snapshot_incompleto,
             COUNT(*) FILTER (WHERE id IS NOT NULL AND origine_snapshot = 'export_fse'
               AND attendibilita_dato = 'anagrafica_derivata') AS snapshot_derivato
      FROM profili
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
          AND (
            mv.natura_contabile NOT IN ('DISTRIBUZIONE_FINALE', 'STORNO', 'LEGACY')
            OR (
              ${authorizedFseMovement}
              AND (mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
                OR (mv.natura_contabile = 'STORNO'
                  AND original.natura_contabile = 'DISTRIBUZIONE_FINALE')
                OR (mv.natura_contabile = 'LEGACY' AND mv.tipo_movimento = 'scarico'))
            )
          )
      ), fse_events AS (
        SELECT op.id,
          op.territorio_classificazione,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.numero_pacchi END AS numero_pacchi,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.numero_pasti END AS numero_pasti,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.indigenti_saltuari END AS indigenti_saltuari,
          CASE WHEN SUM(mv.signed_quantity) = 0 THEN 0 ELSE op.indigenti_continuativi END AS indigenti_continuativi,
          SUM(mv.signed_quantity) = 0 AS annullato_netto,
          BOOL_OR(mv.natura_contabile = 'STORNO')
            AND SUM(mv.signed_quantity) <> 0 AS storno_parziale
        FROM fse_period mv JOIN operazioni_distribuzione_magazzino op
          ON op.id = mv.effective_operation_id
        GROUP BY op.id, op.territorio_classificazione, op.numero_pacchi, op.numero_pasti,
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
        (SELECT count(*) FROM fse_events WHERE NOT annullato_netto) AS eventi,
        (SELECT COALESCE(sum(numero_pacchi),0) FROM fse_events) AS pacchi,
        (SELECT COALESCE(sum(numero_pasti),0) FROM fse_events) AS pasti,
        (SELECT COALESCE(sum(indigenti_saltuari),0) FROM fse_events) AS saltuari,
        (SELECT COALESCE(sum(indigenti_continuativi),0) FROM fse_events) AS continuativi,
        (SELECT count(*) FROM fse_events
          WHERE indigenti_saltuari IS NOT NULL
             OR indigenti_continuativi IS NOT NULL) AS eventi_con_statistiche,
        (SELECT count(*) FROM fse_events WHERE storno_parziale) AS eventi_storno_parziale,
        (SELECT count(*) FROM fse_events
          WHERE territorio_classificazione = 'legacy_sconosciuto') AS eventi_territorio_legacy,
        (SELECT count(*) FROM fse_events
          WHERE territorio_classificazione = 'universale') AS eventi_universali,
        (SELECT count(DISTINCT op_quality.id)
          FROM movimenti mv
          LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
          JOIN magazzini mg ON mg.id = mv.magazzino_id
          JOIN operazioni_distribuzione_magazzino op_quality
            ON op_quality.id = COALESCE(
              mv.operazione_distribuzione_id,
              original.operazione_distribuzione_id
            )
          WHERE ${filters.areaOperativaId == null ? sql`false` : sql`true`}
            AND mv.fondo_origine = 'FSE_PLUS'
            AND mv.data_movimento BETWEEN ${filters.da} AND ${filters.a}
            AND ${warehouseScope}
            AND ${allowedCanonicalChannelCondition}
            AND ${fseDistributionNatureCondition}
            AND op_quality.territorio_classificazione = 'legacy_sconosciuto'
        ) AS eventi_esclusi_mancanza_attribuzione,
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
  const totalFseHouseholds = number(persons.nuclei);
  const householdsWithSnapshot = number(persons.con_snapshot);
  const householdsWithoutSnapshot = number(persons.senza_snapshot);
  const peopleValue = persons.persone == null ? null : number(persons.persone);
  const peopleCoverage = number(persons.copertura_numero_componenti);
  const snapshotAvailability =
    householdsWithSnapshot === 0
      ? "MANCANTE"
      : householdsWithoutSnapshot > 0
        ? "PARZIALE"
        : "DISPONIBILE";
  const dimensionAvailability = (coverage: unknown) => {
    const covered = number(coverage);
    if (covered === 0) return "MANCANTE";
    return covered < totalFseHouseholds ? "PARZIALE" : "DISPONIBILE";
  };

  const availabilityRows = [
    [
      "Prodotti e quantità FSE+",
      "OK",
      "Movimenti",
      "Lo snapshot Fondo del Movimento è autorevole",
    ],
    [
      "Nuclei e persone raggiunte",
      snapshotAvailability,
      "Snapshot FSE Beneficiari as-of",
      `${householdsWithSnapshot} nuclei coperti su ${totalFseHouseholds}`,
    ],
    [
      "Sesso",
      dimensionAvailability(persons.copertura_sesso),
      "Snapshot FSE Beneficiari as-of",
      `Data finale ${filters.a}`,
    ],
    [
      "Fasce d'età",
      dimensionAvailability(persons.copertura_eta),
      "Snapshot FSE Beneficiari as-of",
      `Data finale ${filters.a}`,
    ],
    [
      "Origine straniera/minoranze",
      dimensionAvailability(persons.copertura_origine),
      "Snapshot FSE Beneficiari as-of",
      `${number(persons.copertura_origine)} nuclei coperti su ${totalFseHouseholds}`,
    ],
    [
      "Disabilità individuale",
      dimensionAvailability(persons.copertura_disabilita),
      "Snapshot FSE Beneficiari as-of",
      `${number(persons.copertura_disabilita)} nuclei coperti su ${totalFseHouseholds}`,
    ],
    [
      "Cittadini Paesi Terzi",
      dimensionAvailability(persons.copertura_paesi_terzi),
      "Snapshot FSE Beneficiari as-of",
      `${number(persons.copertura_paesi_terzi)} nuclei coperti su ${totalFseHouseholds}`,
    ],
    [
      "Senzatetto/esclusione abitativa",
      dimensionAvailability(persons.copertura_esclusione),
      "Snapshot FSE Beneficiari as-of",
      `${number(persons.copertura_esclusione)} nuclei coperti su ${totalFseHouseholds}`,
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
    ([, availability]) =>
      availability === "MANCANTE" || availability === "PARZIALE",
  ).length;
  const canViewIndividualFse =
    filters.callerIsAdmin ||
    filters.callerPermissions.includes("beneficiari.fse.view");

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
        null,
        "ok",
        String(ac.distribuzioni_lorde_pezzi ?? "0"),
      ),
      kpi(
        "distribuzioniFseLordeKgLt",
        number(ac.distribuzioni_lorde_kg_lt),
        "kgLt",
        null,
        "ok",
        String(ac.distribuzioni_lorde_kg_lt ?? "0"),
      ),
      kpi(
        "storniDistribuzioniPezzi",
        number(ac.storni_distribuzioni_pezzi),
        "pieces",
        null,
        "ok",
        String(ac.storni_distribuzioni_pezzi ?? "0"),
      ),
      kpi(
        "storniDistribuzioniKgLt",
        number(ac.storni_distribuzioni_kg_lt),
        "kgLt",
        null,
        "ok",
        String(ac.storni_distribuzioni_kg_lt ?? "0"),
      ),
      kpi(
        "distribuzioniFseNettePezzi",
        Math.abs(number(ac.distribuzioni_nette_pezzi)),
        "pieces",
        null,
        "ok",
        String(ac.distribuzioni_nette_pezzi ?? "0").replace(/^-/, ""),
      ),
      kpi(
        "distribuzioniFseNetteKgLt",
        Math.abs(number(ac.distribuzioni_nette_kg_lt)),
        "kgLt",
        null,
        "ok",
        String(ac.distribuzioni_nette_kg_lt ?? "0").replace(/^-/, ""),
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
        canViewIndividualFse ? "nucleiRaggiunti" : null,
      ),
      kpi(
        "personeRaggiunte",
        peopleValue,
        "count",
        canViewIndividualFse && peopleValue != null ? "personeRaggiunte" : null,
        peopleValue == null
          ? "missing"
          : peopleCoverage < totalFseHouseholds
            ? "derivable"
            : "ok",
      ),
      ...(sources.pacchi ? [kpi("pacchiDistribuiti", number(ac.pacchi))] : []),
      ...(sources.mensa ? [kpi("pastiDistribuiti", number(ac.pasti))] : []),
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
            nota: "Canale UDS_STRADA dal ledger canonico; valori aggregati se rilevati",
          },
        ],
      },
      {
        key: "06_Pacchi_Pasti",
        columns: ["pacchi", "pasti"],
        rows: [
          {
            pacchi: sources.pacchi ? number(ac.pacchi) : null,
            pasti: sources.mensa ? number(ac.pasti) : null,
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
        key: "dimensioniFseBeneficiari",
        columns: [
          "campo",
          "valore",
          "nucleiCoperti",
          "nucleiTotali",
          "nucleiSenzaDato",
          "disponibilita",
        ],
        rows: [
          [
            "numeroComponenti",
            persons.persone,
            persons.copertura_numero_componenti,
          ],
          ["sesso", persons.persone_sesso_note, persons.copertura_sesso],
          ["fasceEta", persons.persone_eta_note, persons.copertura_eta],
          [
            "origineStranieraMinoranze",
            persons.origine_straniera_minoranze,
            persons.copertura_origine,
          ],
          [
            "personeDisabilita",
            persons.persone_disabilita,
            persons.copertura_disabilita,
          ],
          [
            "cittadiniPaesiTerzi",
            persons.cittadini_paesi_terzi,
            persons.copertura_paesi_terzi,
          ],
          [
            "esclusioneAbitativa",
            persons.esclusione_abitativa,
            persons.copertura_esclusione,
          ],
        ].map(([campo, valore, copertura]) => ({
          campo: String(campo),
          valore: valore == null ? null : number(valore),
          nucleiCoperti: number(copertura),
          nucleiTotali: totalFseHouseholds,
          nucleiSenzaDato: Math.max(0, totalFseHouseholds - number(copertura)),
          disponibilita:
            number(copertura) === 0
              ? "MANCANTE"
              : number(copertura) < totalFseHouseholds
                ? "PARZIALE"
                : "DISPONIBILE",
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
        "snapshotFseMancante",
        number(dq.snapshot_mancante),
        number(dq.snapshot_mancante) ? "missing" : "ok",
        text("qualityFseSnapshotMissing"),
      ),
      quality(
        "snapshotFseIncompleto",
        number(dq.snapshot_incompleto),
        number(dq.snapshot_incompleto) ? "missing" : "ok",
        text("qualityFseSnapshotIncomplete"),
      ),
      quality(
        "snapshotFseDerivato",
        number(dq.snapshot_derivato),
        number(dq.snapshot_derivato) ? "derivable" : "ok",
        text("qualityFseSnapshotDerived"),
      ),
      quality(
        "statisticheEventoStornoParziale",
        number(ac.eventi_storno_parziale),
        number(ac.eventi_storno_parziale) ? "derivable" : "ok",
        text("qualityFsePartialReversal"),
      ),
      quality(
        "territorioEventoLegacyMancante",
        number(ac.eventi_territorio_legacy),
        number(ac.eventi_territorio_legacy) ? "missing" : "ok",
        text("qualityFseLegacyTerritory"),
      ),
      quality(
        "eventoUniversale",
        number(ac.eventi_universali),
        number(ac.eventi_universali) ? "derivable" : "ok",
        text("qualityFseUniversalEvents"),
      ),
      quality(
        "eventoEsclusoMancanzaAttribuzione",
        number(ac.eventi_esclusi_mancanza_attribuzione),
        number(ac.eventi_esclusi_mancanza_attribuzione) ? "missing" : "ok",
        text("qualityFseExcludedTerritory"),
      ),
      quality(
        "unitaPesoNonNormalizzabile",
        unconvertible,
        unconvertible ? "missing" : "ok",
        text("qualityKgOnly"),
      ),
      quality(
        "dimensioniSifeadMancanti",
        missingSifeadDimensions,
        missingSifeadDimensions ? "missing" : "ok",
        text("qualityMissingFields"),
      ),
    ],
    definitions: [
      text("fseProvenance"),
      text("fseSnapshotAtDate"),
      text("fseFutureSnapshotsExcluded", { date: filters.a }),
      peopleCoverage < totalFseHouseholds
        ? text("fsePeoplePartialCoverage", { covered: peopleCoverage, total: totalFseHouseholds })
        : text("fsePeopleFullCoverage"),
      text("fseSources"),
      text("fseCanonicalChannels"),
      text("fseAdministrativeDates", {
        exportDate: String(administrative.ultima_esportazione ?? "—"),
        importDate: String(administrative.ultima_importazione ?? "—"),
        reconciliationDate: String(administrative.ultima_riconciliazione ?? "—"),
      }),
    ],
  });
}
