import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";

function udsIdentityConditions(filters: ReportFilters): SQL[] {
  return [
    sql`be.uds = true`,
    sql`(i.ambito = 'uds' OR i.ambito IS NULL)`,
    ...reportScope(filters, {
      citta: sql`be.citta_id`,
      centro: sql`be.centro_ascolto_id`,
      zona: sql`be.zona_uds_id`,
    }),
  ];
}

function udsBaseConditions(filters: ReportFilters): SQL[] {
  const conditions = udsIdentityConditions(filters);
  if (filters.operatoreId != null) {
    conditions.push(sql`i.operatore_id = ${filters.operatoreId}`);
  }
  if (filters.tipoIntervento) {
    conditions.push(sql`${filters.tipoIntervento} = ANY(regexp_split_to_array(i.tipo_intervento, '\s*,\s*'))`);
  }
  return conditions;
}

const udsEventDate = sql`COALESCE(i.data_intervento, i.data_creazione::date)`;

export async function udsMetrics(filters: ReportFilters) {
  const identity = andSql(udsIdentityConditions(filters));
  const periodFilters: SQL[] = [sql`giorno BETWEEN ${filters.da} AND ${filters.a}`];
  if (filters.operatoreId != null) periodFilters.push(sql`operatore_id = ${filters.operatoreId}`);
  if (filters.tipoIntervento) {
    periodFilters.push(sql`${filters.tipoIntervento} = ANY(regexp_split_to_array(tipo_intervento, '\s*,\s*'))`);
  }
  const [row] = await rows<Record<string, unknown>>(sql`
    WITH sequenza AS (
      SELECT i.id, i.beneficiario_id, i.operatore_id, i.tipo_intervento,
             ${udsEventDate} AS giorno,
             row_number() OVER (
               PARTITION BY i.beneficiario_id
               ORDER BY ${udsEventDate}, i.id
             ) AS numero
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      WHERE ${identity}
    ), periodo AS (
      SELECT * FROM sequenza WHERE ${andSql(periodFilters)}
    )
    SELECT COUNT(*) AS interventi,
           COUNT(DISTINCT beneficiario_id) AS persone,
           COUNT(*) FILTER (WHERE numero = 1) AS primi_contatti,
           COUNT(*) FILTER (WHERE numero > 1) AS successivi,
           COUNT(DISTINCT beneficiario_id) FILTER (WHERE numero = 1) AS persone_nuove,
           COUNT(DISTINCT beneficiario_id) FILTER (WHERE numero > 1) AS persone_conosciute
    FROM periodo
  `);
  return {
    interventi: number(row?.interventi),
    persone: number(row?.persone),
    primi: number(row?.primi_contatti),
    successivi: number(row?.successivi),
    nuove: number(row?.persone_nuove),
    conosciute: number(row?.persone_conosciute),
  };
}

export async function buildUdsReport(filters: ReportFilters) {
  const base = andSql(udsBaseConditions(filters));
  const period = sql`${udsEventDate} BETWEEN ${filters.da} AND ${filters.a}`;
  const metrics = await udsMetrics(filters);
  const [monthly, types, zones, operators, dqRows] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT to_char(${udsEventDate}, 'YYYY-MM') AS mese, COUNT(*) AS totale,
             COUNT(DISTINCT i.beneficiario_id) AS persone
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      WHERE ${base} AND ${period} GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      SELECT tipo, COUNT(*) AS totale
      FROM (
        SELECT trim(tipo) AS tipo
        FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id,
        LATERAL unnest(regexp_split_to_array(i.tipo_intervento, '\s*,\s*')) tipo
        WHERE ${base} AND ${period}
      ) classificati WHERE tipo <> '' GROUP BY tipo ORDER BY totale DESC, tipo
    `),
    rows<Record<string, unknown>>(sql`
      SELECT be.zona_uds_id AS zona_id, COALESCE(z.nome, 'Senza zona') AS zona,
             COUNT(*) AS interventi, COUNT(DISTINCT i.beneficiario_id) AS persone
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      LEFT JOIN zone_uds z ON z.id = be.zona_uds_id
      WHERE ${base} AND ${period}
      GROUP BY be.zona_uds_id, z.nome ORDER BY interventi DESC, zona
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(u.matricola, u.username, 'Non assegnato') AS operatore,
             COUNT(*) AS interventi
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      LEFT JOIN utenti u ON u.id = i.operatore_id
      WHERE ${base} AND ${period}
      GROUP BY u.id, u.matricola, u.username ORDER BY interventi DESC, operatore
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE i.ambito IS NULL) AS ambito_legacy,
             COUNT(*) FILTER (WHERE be.citta_id IS NULL) AS citta_mancante,
             COUNT(*) FILTER (WHERE be.zona_uds_id IS NULL) AS zona_mancante
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      WHERE ${base} AND ${period}
    `),
  ]);
  const dq = dqRows[0] ?? {};

  return dashboard({
    section: "uds",
    filters,
    kpi: [
      kpi("interventi", metrics.interventi, "count", "interventi"),
      kpi("personeUniche", metrics.persone, "count", "personeUniche"),
      kpi("primiContatti", metrics.primi, "count", "primiContatti"),
      kpi("contattiSuccessivi", metrics.successivi),
      kpi("personeNuove", metrics.nuove),
      kpi("personeConosciute", metrics.conosciute),
    ],
    series: [{ key: "interventiPerMese", points: monthSeries(monthly, "totale", "persone") }],
    tables: [
      { key: "tipologie", columns: ["tipo", "totale"], rows: types.map((r) => ({ tipo: String(r.tipo), totale: number(r.totale) })) },
      { key: "zone", columns: ["zonaId", "zona", "interventi", "persone"], rows: zones.map((r) => ({ zonaId: r.zona_id == null ? null : number(r.zona_id), zona: String(r.zona), interventi: number(r.interventi), persone: number(r.persone) })) },
      { key: "operatori", columns: ["operatore", "interventi"], rows: operators.map((r) => ({ operatore: String(r.operatore), interventi: number(r.interventi) })) },
    ],
    quality: [
      quality("ambitoLegacy", number(dq.ambito_legacy), number(dq.ambito_legacy) ? "derivable" : "ok", "Gli interventi legacy NULL seguono la compatibilità UDS esistente."),
      quality("cittaMancante", number(dq.citta_mancante), number(dq.citta_mancante) ? "missing" : "ok"),
      quality("zonaMancante", number(dq.zona_mancante), number(dq.zona_mancante) ? "derivable" : "ok"),
    ],
    definitions: [
      "Intervento UDS = persona con flag uds e intervento ambito uds oppure NULL legacy.",
      "Primo contatto = numero cronologico 1 sull'intera storia della persona, prima di applicare il periodo.",
      "Le note libere non vengono interpretate né incluse nelle dimensioni statistiche.",
    ],
  });
}

export { udsBaseConditions, udsIdentityConditions, udsEventDate };
