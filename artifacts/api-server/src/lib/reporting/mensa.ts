import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { reportingAgeBandSql } from "./ageBands";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";

function mealConditions(filters: ReportFilters): SQL[] {
  const conditions = [
    sql`mp.data_servizio BETWEEN ${filters.da} AND ${filters.a}`,
    ...reportScope(filters, {
      areaOperativa: sql`m.area_operativa_id`,
      centro: sql`mg.centro_ascolto_id`,
      magazzino: sql`m.magazzino_id`,
      mensa: sql`mp.mensa_id`,
      operatore: sql`mp.operatore_id`,
    }),
  ];
  if (filters.tipoServizio) {
    conditions.push(sql`mp.tipo_servizio = ${filters.tipoServizio}`);
  }
  return conditions;
}

function mensaAccessConditions(filters: ReportFilters): SQL[] {
  return [
    sql`(ma.data_ora AT TIME ZONE 'Europe/Rome')::date BETWEEN ${filters.da} AND ${filters.a}`,
    ...reportScope(filters, {
      areaOperativa: sql`m.area_operativa_id`,
      centro: sql`mg.centro_ascolto_id`,
      magazzino: sql`m.magazzino_id`,
      mensa: sql`ma.mensa_id`,
      operatore: sql`ma.operatore_id`,
    }),
  ];
}

export async function mensaMetrics(filters: ReportFilters) {
  const mealsWhere = andSql(mealConditions(filters));
  const accessWhere = andSql(mensaAccessConditions(filters));
  const [meals, access] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS pasti,
             COUNT(DISTINCT mp.beneficiario_id) AS persone,
             COUNT(DISTINCT mp.data_servizio) AS giornate,
             COUNT(*) FILTER (WHERE mp.override = true) AS override
      FROM mensa_pasti mp
      JOIN mense m ON m.id = mp.mensa_id
      JOIN magazzini mg ON mg.id = m.magazzino_id
      WHERE ${mealsWhere}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE ma.esito = 'consentito') AS ordinari,
             COUNT(*) FILTER (WHERE ma.esito = 'consentito_eccezione') AS eccezioni,
             COUNT(*) FILTER (WHERE ma.esito = 'negato') AS negati
      FROM mensa_accessi ma
      JOIN mense m ON m.id = ma.mensa_id
      JOIN magazzini mg ON mg.id = m.magazzino_id
      WHERE ${accessWhere}
    `),
  ]);
  const meal = meals[0] ?? {};
  const pasti = number(meal.pasti);
  const giornate = number(meal.giornate);
  const acc = access[0] ?? {};
  return {
    pasti,
    persone: number(meal.persone),
    giornate,
    media: giornate === 0 ? 0 : Number((pasti / giornate).toFixed(2)),
    ordinari: number(acc.ordinari),
    eccezioni: number(acc.eccezioni),
    negati: number(acc.negati),
    override: number(meal.override),
  };
}

export async function buildMensaReport(filters: ReportFilters) {
  const mealsWhere = andSql(mealConditions(filters));
  const metrics = await mensaMetrics(filters);
  const ageBand = reportingAgeBandSql(
    sql`be.data_nascita`,
    sql`be.fascia_eta_presunta`,
    filters.a,
  );
  const [daily, monthly, distribution, services, sex, ages, dqRows] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT mp.data_servizio::text AS giorno, COUNT(*) AS totale,
             COUNT(DISTINCT mp.beneficiario_id) AS persone
      FROM mensa_pasti mp
      JOIN mense m ON m.id = mp.mensa_id JOIN magazzini mg ON mg.id = m.magazzino_id
      WHERE ${mealsWhere} GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      SELECT to_char(mp.data_servizio, 'YYYY-MM') AS mese, COUNT(*) AS totale,
             COUNT(DISTINCT mp.beneficiario_id) AS persone
      FROM mensa_pasti mp
      JOIN mense m ON m.id = mp.mensa_id JOIN magazzini mg ON mg.id = m.magazzino_id
      WHERE ${mealsWhere} GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      SELECT m.id AS mensa_id, m.nome AS mensa_nome, COUNT(*) AS pasti,
             COUNT(DISTINCT mp.beneficiario_id) AS persone,
             COUNT(*) FILTER (WHERE mp.eccezione_id IS NOT NULL) AS eccezioni,
             COUNT(*) FILTER (WHERE mp.override = true) AS override
      FROM mensa_pasti mp
      JOIN mense m ON m.id = mp.mensa_id JOIN magazzini mg ON mg.id = m.magazzino_id
      WHERE ${mealsWhere}
      GROUP BY m.id, m.nome ORDER BY pasti DESC, m.nome
    `),
    rows<Record<string, unknown>>(sql`
      SELECT mp.tipo_servizio AS tipo, COUNT(*) AS pasti,
             COUNT(DISTINCT mp.beneficiario_id) AS persone
      FROM mensa_pasti mp
      JOIN mense m ON m.id = mp.mensa_id JOIN magazzini mg ON mg.id = m.magazzino_id
      WHERE ${mealsWhere} GROUP BY mp.tipo_servizio ORDER BY pasti DESC, tipo
    `),
    rows<Record<string, unknown>>(sql`
      WITH persone AS (
        SELECT DISTINCT mp.beneficiario_id
        FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
        JOIN magazzini mg ON mg.id = m.magazzino_id WHERE ${mealsWhere}
      )
      SELECT COALESCE(NULLIF(trim(be.sesso), ''), 'non_determinato') AS sesso,
             COUNT(*) AS persone
      FROM persone p JOIN beneficiari be ON be.id = p.beneficiario_id
      GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      WITH persone_ids AS (
        SELECT DISTINCT mp.beneficiario_id
        FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
        JOIN magazzini mg ON mg.id = m.magazzino_id WHERE ${mealsWhere}
      ), persone AS (
        SELECT ${ageBand} AS fascia
        FROM persone_ids p JOIN beneficiari be ON be.id = p.beneficiario_id
      )
      SELECT fascia, COUNT(*) AS persone FROM persone
      GROUP BY fascia ORDER BY CASE fascia
        WHEN '0_17' THEN 1 WHEN '18_29' THEN 2 WHEN '30_64' THEN 3
        WHEN '65_plus' THEN 4 ELSE 5 END
    `),
    rows<Record<string, unknown>>(sql`
      WITH persone AS (
        SELECT DISTINCT mp.beneficiario_id
        FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
        JOIN magazzini mg ON mg.id = m.magazzino_id WHERE ${mealsWhere}
      )
      SELECT COUNT(*) FILTER (WHERE be.data_nascita IS NULL AND be.fascia_eta_presunta IS NULL) AS eta_mancante,
             COUNT(*) FILTER (WHERE be.data_nascita IS NULL AND be.fascia_eta_presunta IS NOT NULL) AS fascia_presunta,
             COUNT(*) FILTER (WHERE be.sesso IS NULL OR trim(be.sesso) = '') AS sesso_mancante
      FROM persone p JOIN beneficiari be ON be.id = p.beneficiario_id
    `),
  ]);
  const dq = dqRows[0] ?? {};

  return dashboard({
    section: "mensa",
    filters,
    kpi: [
      kpi("pastiErogati", metrics.pasti, "count", "pastiErogati"),
      kpi("personeUniche", metrics.persone, "count", "personeUniche"),
      kpi("giornateServizio", metrics.giornate, "days"),
      kpi("mediaPastiGiornata", metrics.media, "average"),
      kpi("accessiOrdinari", metrics.ordinari),
      kpi("accessiEccezione", metrics.eccezioni),
      kpi("accessiNegati", metrics.negati, "count", "accessiNegati"),
      kpi("overrideAutorizzati", metrics.override),
    ],
    series: [
      { key: "pastiPerGiorno", points: daily.map((r) => ({ label: String(r.giorno), value: number(r.totale), secondaryValue: number(r.persone) })) },
      { key: "pastiPerMese", points: monthSeries(monthly, "totale", "persone") },
    ],
    tables: [
      { key: "mense", columns: ["mensaId", "mensaNome", "pasti", "persone", "eccezioni", "override"], rows: distribution.map((r) => ({ mensaId: number(r.mensa_id), mensaNome: String(r.mensa_nome), pasti: number(r.pasti), persone: number(r.persone), eccezioni: number(r.eccezioni), override: number(r.override) })) },
      { key: "servizi", columns: ["tipo", "pasti", "persone"], rows: services.map((r) => ({ tipo: String(r.tipo), pasti: number(r.pasti), persone: number(r.persone) })) },
      { key: "sesso", columns: ["sesso", "persone"], rows: sex.map((r) => ({ sesso: String(r.sesso), persone: number(r.persone) })) },
      { key: "fasceEta", columns: ["fascia", "persone"], rows: ages.map((r) => ({ fascia: String(r.fascia), persone: number(r.persone) })) },
    ],
    quality: [
      quality("etaMancante", number(dq.eta_mancante), number(dq.eta_mancante) ? "missing" : "ok"),
      quality("fasciaEtaPresuntaUsata", number(dq.fascia_presunta), number(dq.fascia_presunta) ? "derivable" : "ok", `Fascia valutata alla data finale ${filters.a}.`),
      quality("sessoMancante", number(dq.sesso_mancante), number(dq.sesso_mancante) ? "missing" : "ok"),
    ],
    definitions: [
      "Pasto erogato = record mensa_pasti registrato nella data civile Europe/Rome.",
      "Persona servita = beneficiario distinto dei pasti; un accesso negato non conta.",
      `Le fasce d'età delle persone uniche sono calcolate alla data finale ${filters.a}.`,
      "Media pasti = pasti diviso giornate con almeno un servizio, non giorni di calendario.",
    ],
  });
}

export { mealConditions, mensaAccessConditions };
