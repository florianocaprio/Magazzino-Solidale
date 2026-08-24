import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";
import { intervalloGiornoEuropeRome } from "../interventiViste";

const eventDate = sql`(
  COALESCE(
    i.data_ora_conclusione,
    i.data_ora_pianificata,
    i.data_ora_avvio,
    i.data_intervento::timestamp AT TIME ZONE 'Europe/Rome',
    i.data_creazione AT TIME ZONE 'Europe/Rome'
  ) AT TIME ZONE 'Europe/Rome'
)::date`;

function socialConditions(filters: ReportFilters): SQL[] {
  const conditions: SQL[] = [
    sql`(i.ambito = 'sociale' OR i.ambito IS NULL)`,
    sql`${eventDate} BETWEEN ${filters.da} AND ${filters.a}`,
    ...reportScope(filters, {
      areaOperativa: sql`COALESCE(i.area_operativa_id_snapshot, be.area_operativa_id)`,
      centro: sql`COALESCE(i.centro_ascolto_id_snapshot, be.centro_ascolto_id)`,
      zona: sql`be.zona_uds_id`,
      operatore: sql`i.operatore_id`,
    }),
  ];
  if (filters.tipoIntervento) {
    conditions.push(sql`${filters.tipoIntervento} = ANY(regexp_split_to_array(i.tipo_intervento, '\s*,\s*'))`);
  }
  return conditions;
}

function socialCompletedConditions(filters: ReportFilters): SQL[] {
  return [...socialConditions(filters), sql`i.stato = 'concluso'`];
}

function plannedCutoff(filters: ReportFilters): SQL {
  return sql`LEAST(
    (${filters.a}::date + interval '1 day') AT TIME ZONE 'Europe/Rome',
    CURRENT_TIMESTAMP
  )`;
}

export function isSocialPlannedExpired(
  plannedAt: Date,
  reportEnd: string,
  now = new Date(),
): boolean {
  const reportEndExclusive = intervalloGiornoEuropeRome(reportEnd).end;
  const cutoff = Math.min(reportEndExclusive.getTime(), now.getTime());
  return plannedAt.getTime() < cutoff;
}

export async function socialMetrics(filters: ReportFilters) {
  const where = andSql(socialConditions(filters));
  const cutoff = plannedCutoff(filters);
  const [row] = await rows<Record<string, unknown>>(sql`
    SELECT COUNT(*) FILTER (WHERE i.stato = 'concluso') AS interventi,
           COUNT(DISTINCT i.beneficiario_id) FILTER (WHERE i.stato = 'concluso') AS persone,
           COUNT(*) FILTER (WHERE i.stato = 'da_pianificare') AS da_pianificare,
           COUNT(*) FILTER (
             WHERE i.stato = 'pianificato' AND i.data_ora_pianificata >= ${cutoff}
           ) AS pianificati,
           COUNT(*) FILTER (WHERE i.stato = 'concluso') AS conclusi,
           COUNT(*) FILTER (WHERE i.stato = 'mancata_presentazione') AS mancati,
           COUNT(*) FILTER (WHERE i.stato = 'annullato') AS annullati,
           COUNT(*) FILTER (
             WHERE i.stato = 'pianificato'
               AND i.data_ora_pianificata < ${cutoff}
           ) AS scaduti,
           COUNT(DISTINCT i.operatore_id) FILTER (
             WHERE i.operatore_id IS NOT NULL AND i.stato = 'concluso'
           ) AS operatori
    FROM interventi i
    JOIN beneficiari be ON be.id = i.beneficiario_id
    WHERE ${where}
  `);
  const [taken] = await rows<Record<string, unknown>>(sql`
    SELECT COUNT(DISTINCT be.id) AS totale
    FROM beneficiari be
    WHERE be.data_presa_in_carico BETWEEN ${filters.da} AND ${filters.a}
      AND ${andSql(reportScope(filters, {
        areaOperativa: sql`be.area_operativa_id`,
        centro: sql`be.centro_ascolto_id`,
        zona: sql`be.zona_uds_id`,
      }))}
  `);
  return {
    preseInCarico: number(taken?.totale),
    persone: number(row?.persone),
    interventi: number(row?.interventi),
    daPianificare: number(row?.da_pianificare),
    pianificati: number(row?.pianificati),
    conclusi: number(row?.conclusi),
    mancatePresentazioni: number(row?.mancati),
    annullati: number(row?.annullati),
    scaduti: number(row?.scaduti),
    operatori: number(row?.operatori),
  };
}

export async function buildCentroAscoltoReport(filters: ReportFilters) {
  const where = andSql(socialConditions(filters));
  const completedWhere = andSql(socialCompletedConditions(filters));
  const metrics = await socialMetrics(filters);
  const [monthly, types, operators, centres, dqRows] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT to_char(${eventDate}, 'YYYY-MM') AS mese,
             COUNT(*) AS totale,
             COUNT(DISTINCT i.beneficiario_id) AS persone
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      WHERE ${completedWhere} GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      SELECT tipo, COUNT(*) AS totale
      FROM (
        SELECT trim(tipo) AS tipo
        FROM interventi i
        JOIN beneficiari be ON be.id = i.beneficiario_id,
        LATERAL unnest(regexp_split_to_array(i.tipo_intervento, '\s*,\s*')) tipo
        WHERE ${completedWhere}
      ) classificati
      WHERE tipo <> '' GROUP BY tipo ORDER BY totale DESC, tipo
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(u.matricola, u.username, 'Non assegnato') AS operatore,
             COUNT(*) AS totale
      FROM interventi i
      JOIN beneficiari be ON be.id = i.beneficiario_id
      LEFT JOIN utenti u ON u.id = i.operatore_id
      WHERE ${completedWhere}
      GROUP BY u.id, u.matricola, u.username ORDER BY totale DESC, operatore
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(ca.nome, 'Senza centro') AS centro, COUNT(*) AS totale,
             COUNT(DISTINCT i.beneficiario_id) AS persone
      FROM interventi i
      JOIN beneficiari be ON be.id = i.beneficiario_id
      LEFT JOIN centri_di_ascolto ca ON ca.id = COALESCE(i.centro_ascolto_id_snapshot, be.centro_ascolto_id)
      WHERE ${completedWhere}
      GROUP BY ca.id, ca.nome ORDER BY totale DESC, centro
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE i.ambito IS NULL) AS ambito_legacy,
             COUNT(*) FILTER (WHERE i.operatore_id IS NULL) AS operatore_mancante,
             COUNT(*) FILTER (WHERE trim(i.tipo_intervento) = '') AS tipo_mancante,
             COUNT(*) FILTER (WHERE i.area_operativa_id_snapshot IS NULL OR i.centro_ascolto_id_snapshot IS NULL) AS territorio_legacy
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      WHERE ${where}
    `),
  ]);
  const dq = dqRows[0] ?? {};

  return dashboard({
    section: "centro-ascolto",
    filters,
    kpi: [
      kpi("personePreseInCarico", metrics.preseInCarico, "count", "personePreseInCarico"),
      kpi("personeServite", metrics.persone, "count", "personeServite"),
      kpi("interventiEffettuati", metrics.interventi, "count", "interventi"),
      kpi("colloquiAccoglienza", null, "count", null, "missing"),
      kpi("colloquiFollowup", null, "count", null, "missing"),
      kpi("daPianificare", metrics.daPianificare),
      kpi("pianificati", metrics.pianificati),
      kpi("mancatePresentazioni", metrics.mancatePresentazioni),
      kpi("annullati", metrics.annullati),
      kpi("scaduti", metrics.scaduti),
      kpi("operatoriCoinvolti", metrics.operatori),
    ],
    series: [
      {
        key: "interventiPerMese",
        points: monthSeries(monthly, "totale", "persone"),
      },
    ],
    tables: [
      {
        key: "tipologie",
        columns: ["tipo", "totale"],
        rows: types.map((r) => ({
          tipo: String(r.tipo),
          totale: number(r.totale),
        })),
      },
      {
        key: "operatori",
        columns: ["operatore", "totale"],
        rows: operators.map((r) => ({
          operatore: String(r.operatore),
          totale: number(r.totale),
        })),
      },
      {
        key: "centri",
        columns: ["centro", "totale", "persone"],
        rows: centres.map((r) => ({
          centro: String(r.centro),
          totale: number(r.totale),
          persone: number(r.persone),
        })),
      },
    ],
    quality: [
      quality(
        "ambitoLegacy",
        number(dq.ambito_legacy),
        number(dq.ambito_legacy) ? "derivable" : "ok",
        "I record legacy con ambito NULL seguono la vista Sociale corrente.",
      ),
      quality(
        "operatoreMancante",
        number(dq.operatore_mancante),
        number(dq.operatore_mancante) ? "derivable" : "ok",
      ),
      quality(
        "territorioStoricoDerivato",
        number(dq.territorio_legacy),
        number(dq.territorio_legacy) ? "derivable" : "ok",
        "Territorio derivato dall'anagrafica corrente soltanto per interventi Sociali legacy privi di snapshot.",
      ),
      quality(
        "classificazioneAccoglienzaMancante",
        null,
        "missing",
        "Le tipologie sono configurabili e non possiedono una categoria semantica accoglienza/follow-up.",
      ),
    ],
    definitions: [
      "Intervento Sociale = ambito sociale oppure ambito NULL legacy, coerentemente con la vista operativa corrente.",
      "Intervento effettuato = intervento Sociale nello stato concluso.",
      "Persona servita = beneficiario distinto con almeno un intervento concluso nel periodo.",
      "Scaduto = intervento ancora pianificato con data/ora precedente al minore tra fine periodo e ora corrente Europe/Rome.",
      "Le note riservate non sono dimensioni analitiche e non vengono esportate.",
    ],
  });
}

export { socialConditions, socialCompletedConditions, plannedCutoff, eventDate as socialEventDate };
