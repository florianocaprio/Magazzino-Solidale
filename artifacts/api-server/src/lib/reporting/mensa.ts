import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality, text } from "./shared";
import { appendReportPanels, requestReportPanel } from "./requests";

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
    ...(filters.tipoServizio
      ? [sql`ma.tipo_servizio = ${filters.tipoServizio}`]
      : []),
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
    exact: {
      pasti: String(meal.pasti ?? "0"),
      persone: String(meal.persone ?? "0"),
      giornate: String(meal.giornate ?? "0"),
      override: String(meal.override ?? "0"),
      ordinari: String(acc.ordinari ?? "0"),
      eccezioni: String(acc.eccezioni ?? "0"),
      negati: String(acc.negati ?? "0"),
    },
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
  const dayWhere = andSql([
    sql`g.data_servizio BETWEEN ${filters.da} AND ${filters.a}`,
    ...(filters.tipoServizio
      ? [sql`g.tipo_servizio = ${filters.tipoServizio}`]
      : []),
    ...reportScope(filters, {
      areaOperativa: sql`m.area_operativa_id`,
      centro: sql`mg.centro_ascolto_id`,
      magazzino: sql`m.magazzino_id`,
      mensa: sql`g.mensa_id`,
    }),
  ]);
  const [denominators] = await rows<Record<string, string | null>>(sql`
    SELECT (${filters.a}::date - ${filters.da}::date + 1)::text AS calendario,
      COUNT(*)::text AS giornate,
      ROUND(${metrics.exact.pasti}::numeric / (${filters.a}::date - ${filters.da}::date + 1), 2)::text AS media_calendario,
      ROUND(${metrics.exact.pasti}::numeric / NULLIF(COUNT(*), 0), 2)::text AS media_giornate
    FROM mensa_giornate_servizio g JOIN mense m ON m.id=g.mensa_id
    JOIN magazzini mg ON mg.id=m.magazzino_id WHERE ${dayWhere}
  `);
  const [daily, monthly, distribution, services, sex, ages, dqRows] =
    await Promise.all([
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
      SELECT COALESCE(NULLIF(mp.sesso_snapshot, ''), 'non_determinato') AS sesso,
             COUNT(DISTINCT mp.beneficiario_id) AS persone, COUNT(*) AS pasti
      FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
      JOIN magazzini mg ON mg.id = m.magazzino_id WHERE ${mealsWhere}
      GROUP BY 1 ORDER BY 1
    `),
      rows<Record<string, unknown>>(sql`
      SELECT COALESCE(mp.fascia_eta_snapshot, 'non_determinato') AS fascia,
        COUNT(DISTINCT mp.beneficiario_id) AS persone, COUNT(*) AS pasti
      FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
      JOIN magazzini mg ON mg.id = m.magazzino_id WHERE ${mealsWhere}
      GROUP BY mp.fascia_eta_snapshot ORDER BY CASE mp.fascia_eta_snapshot
        WHEN '0_17' THEN 1 WHEN '18_29' THEN 2 WHEN '30_64' THEN 3
        WHEN '65_plus' THEN 4 ELSE 5 END
    `),
      rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE mp.fascia_eta_snapshot IS NULL OR mp.fascia_eta_snapshot = 'ND') AS eta_mancante,
             COUNT(*) FILTER (WHERE mp.fascia_eta_origine_snapshot = 'presunta') AS fascia_presunta,
             COUNT(*) FILTER (WHERE mp.sesso_snapshot IS NULL OR mp.sesso_snapshot = 'ND') AS sesso_mancante,
             COUNT(*) FILTER (WHERE mp.temporaneo_snapshot = true) AS temporanei,
             COUNT(*) FILTER (WHERE mp.temporaneo_snapshot IS NULL) AS temporaneita_mancante
      FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
      JOIN magazzini mg ON mg.id = m.magazzino_id WHERE ${mealsWhere}
    `),
    ]);
  const dq = dqRows[0] ?? {};
  const ratio = (key: string, exact: string | null, denominator: string) => ({
    ...kpi(
      key,
      exact == null ? null : Number(exact),
      "average",
      null,
      exact == null ? "missing" : "ok",
      exact,
    ),
    numerator: metrics.exact.pasti,
    denominator,
    presentationDecimals: 2,
  });

  const requests = await requestReportPanel(filters, true);
  // Same current-net universe as the vertical giornata: storni are excluded,
  // never inferred from supplies or attributed to individual meals.
  const consumption = await rows<Record<string, string>>(sql`
    SELECT p.nome AS prodotto, mc.unita_misura AS unita, mc.causale,
      SUM(mc.quantita)::text AS quantita
    FROM mensa_consumi mc JOIN mensa_giornate_servizio g ON g.id=mc.giornata_servizio_id
    JOIN mense m ON m.id=g.mensa_id JOIN magazzini mg ON mg.id=m.magazzino_id
    JOIN prodotti p ON p.id=mc.prodotto_id
    LEFT JOIN mensa_consumi_storni ms ON ms.consumo_id=mc.id
    WHERE ms.id IS NULL AND ${dayWhere}
      AND ${filters.operatoreId == null ? sql`true` : sql`mc.operatore_id = ${filters.operatoreId}`}
    GROUP BY p.id,p.nome,mc.unita_misura,mc.causale ORDER BY p.id,mc.unita_misura,mc.causale
  `);
  return appendReportPanels(
    dashboard({
      section: "mensa",
      filters,
      kpi: [
        kpi(
          "pastiErogati",
          metrics.pasti,
          "count",
          "pastiErogati",
          "ok",
          metrics.exact.pasti,
        ),
        kpi(
          "personeUniche",
          metrics.persone,
          "count",
          "personeUniche",
          "ok",
          metrics.exact.persone,
        ),
        kpi(
          "giornateServizio",
          metrics.giornate,
          "days",
          null,
          "ok",
          metrics.exact.giornate,
        ),
        kpi("mediaPastiGiornata", metrics.media, "average"),
        kpi(
          "giorniCalendario",
          number(denominators.calendario),
          "days",
          null,
          "ok",
          denominators.calendario,
        ),
        kpi(
          "giornateMensaServizio",
          number(denominators.giornate),
          "count",
          null,
          "ok",
          denominators.giornate,
        ),
        ratio(
          "mediaPastiCalendario",
          denominators.media_calendario,
          denominators.calendario!,
        ),
        ratio(
          "mediaPastiMensaServizio",
          denominators.media_giornate,
          denominators.giornate!,
        ),
        kpi(
          "pastiTemporanei",
          number(dq.temporanei),
          "count",
          null,
          "ok",
          String(dq.temporanei),
        ),
        kpi(
          "accessiOrdinari",
          metrics.ordinari,
          "count",
          null,
          "ok",
          metrics.exact.ordinari,
        ),
        kpi(
          "accessiEccezione",
          metrics.eccezioni,
          "count",
          null,
          "ok",
          metrics.exact.eccezioni,
        ),
        kpi(
          "accessiNegati",
          metrics.negati,
          "count",
          "accessiNegati",
          "ok",
          metrics.exact.negati,
        ),
        kpi(
          "overrideAutorizzati",
          metrics.override,
          "count",
          null,
          "ok",
          metrics.exact.override,
        ),
      ],
      series: [
        {
          key: "pastiPerGiorno",
          points: daily.map((r) => ({
            label: String(r.giorno),
            value: number(r.totale),
            secondaryValue: number(r.persone),
            exactValue: String(r.totale),
            exactSecondaryValue: String(r.persone),
          })),
        },
        {
          key: "pastiPerMese",
          points: monthSeries(monthly, "totale", "persone"),
        },
      ],
      tables: [
        {
          key: "consumiScartiMensa",
          columns: ["prodotto", "unita", "causale", "quantita"],
          rows: consumption,
        },
        {
          key: "mense",
          columns: [
            "mensaId",
            "mensaNome",
            "pasti",
            "persone",
            "eccezioni",
            "override",
          ],
          rows: distribution.map((r) => ({
            mensaId: number(r.mensa_id),
            mensaNome: String(r.mensa_nome),
            pasti: String(r.pasti),
            persone: String(r.persone),
            eccezioni: String(r.eccezioni),
            override: String(r.override),
          })),
        },
        {
          key: "servizi",
          columns: ["tipo", "pasti", "persone"],
          rows: services.map((r) => ({
            tipo: String(r.tipo),
            pasti: String(r.pasti),
            persone: String(r.persone),
          })),
        },
        {
          key: "sesso",
          columns: ["sesso", "persone", "pasti"],
          rows: sex.map((r) => ({
            sesso: String(r.sesso),
            persone: String(r.persone),
            pasti: String(r.pasti),
          })),
        },
        {
          key: "fasceEta",
          columns: ["fascia", "persone", "pasti"],
          rows: ages.map((r) => ({
            fascia: String(r.fascia),
            persone: String(r.persone),
            pasti: String(r.pasti),
          })),
        },
      ],
      quality: [
        quality(
          "etaMancante",
          number(dq.eta_mancante),
          number(dq.eta_mancante) ? "missing" : "ok",
        ),
        quality(
          "fasciaEtaPresuntaUsata",
          number(dq.fascia_presunta),
          number(dq.fascia_presunta) ? "derivable" : "ok",
          text("mensaHistoricalDemography"),
        ),
        quality(
          "sessoMancante",
          number(dq.sesso_mancante),
          number(dq.sesso_mancante) ? "missing" : "ok",
        ),
        quality(
          "temporaneitaMancante",
          number(dq.temporaneita_mancante),
          number(dq.temporaneita_mancante) ? "missing" : "ok",
        ),
      ],
      definitions: [
        text("mensaMeal"),
        text("mensaServedPerson"),
        text("mensaHistoricalDemography"),
        text("mensaDenominators"),
        text("mensaAverage"),
        text("mensaConsumptionNet"),
      ],
    }),
    requests,
  );
}

export { mealConditions, mensaAccessConditions };
