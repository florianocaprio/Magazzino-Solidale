import { sql, type SQL } from "drizzle-orm";
import { isReportModuleActive as isModuloAttivo } from "./queryContext";
import type { ReportFilters, ReportKpi } from "./types";
import { andSql, number, rows, utcTimestampRomeDate } from "./sql";
import { dashboard, kpi, text } from "./shared";
import { pacchiConditions, pacchiMetrics } from "./pacchi";
import {
  socialCompletedConditions,
  socialMetrics,
  socialEventDate,
} from "./centroAscolto";
import { emporioMetrics, speseConditions } from "./emporio";
import { mealConditions, mensaMetrics } from "./mensa";
import { udsBaseConditions, udsEventDate, udsMetrics } from "./uds";

type ActiveSources = {
  pacchi: boolean;
  sociale: boolean;
  emporio: boolean;
  mensa: boolean;
  uds: boolean;
};

async function activeSources(filters: ReportFilters): Promise<ActiveSources> {
  const [magazzino, bolle, sociale, emporio, mensa, uds] = await Promise.all([
    isModuloAttivo("MAGAZZINO_SOLIDALE"),
    isModuloAttivo("BOLLE"),
    isModuloAttivo("CENTRO_ASCOLTO"),
    isModuloAttivo("EMPORIO_SOLIDALE"),
    isModuloAttivo("MENSA"),
    isModuloAttivo("UDS"),
  ]);
  const canRead = (area: string) =>
    filters.callerIsAdmin || filters.callerAreas.includes(area);
  const canReadMensa =
    filters.callerIsAdmin ||
    (filters.callerAreas.includes("mensa") &&
      filters.callerPermissions.includes("mensa.reports.view"));
  const canReadUds =
    filters.callerIsAdmin ||
    (filters.callerAreas.includes("uds") &&
      filters.callerPermissions.includes("uds.reports.view"));
  return {
    pacchi:
      magazzino &&
      bolle &&
      canRead("sociale") &&
      (filters.callerIsAdmin ||
        filters.callerPermissions.includes("bolle.view")),
    sociale: sociale && canRead("sociale") && (filters.callerIsAdmin || (filters.callerPermissions.includes("sociale.interventi.view") && filters.callerPermissions.includes("beneficiari.view"))),
    emporio: emporio && canRead("emporio") && (filters.callerIsAdmin || (filters.callerPermissions.includes("emporio.sales.view") && filters.callerPermissions.includes("credito.view"))),
    mensa: mensa && canReadMensa && filters.callerMensaIds?.length !== 0,
    uds: uds && canReadUds,
  };
}

function eventUnions(filters: ReportFilters, active: ActiveSources): SQL[] {
  const unions: SQL[] = [];
  if (active.pacchi) {
    unions.push(sql`SELECT b.beneficiario_id, b.data_bolla::date AS giorno, 'pacchi'::text AS area,
      COALESCE(b.area_operativa_id_snapshot, be.area_operativa_id) AS area_operativa_id,
      COALESCE(b.centro_ascolto_id_snapshot, be.centro_ascolto_id) AS centro_ascolto_id
      FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
      WHERE ${andSql(pacchiConditions(filters))}`);
  }
  if (active.sociale) {
    unions.push(sql`SELECT i.beneficiario_id, ${socialEventDate} AS giorno, 'centro-ascolto'::text AS area,
      COALESCE(i.area_operativa_id_snapshot, be.area_operativa_id) AS area_operativa_id,
      COALESCE(i.centro_ascolto_id_snapshot, be.centro_ascolto_id) AS centro_ascolto_id
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      WHERE ${andSql(socialCompletedConditions(filters))}`);
  }
  if (active.emporio) {
    unions.push(sql`SELECT se.beneficiario_id, ${utcTimestampRomeDate(sql`se.data_chiusura`)} AS giorno, 'emporio'::text AS area,
      se.area_operativa_id, se.centro_ascolto_id
      FROM spese_emporio se WHERE ${andSql(speseConditions(filters))}`);
  }
  if (active.mensa) {
    unions.push(sql`SELECT mp.beneficiario_id, mp.data_servizio AS giorno, 'mensa'::text AS area,
      m.area_operativa_id, mg.centro_ascolto_id
      FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
      JOIN magazzini mg ON mg.id = m.magazzino_id
      WHERE ${andSql(mealConditions(filters))}`);
  }
  if (active.uds) {
    unions.push(sql`SELECT i.beneficiario_id, ${udsEventDate} AS giorno, 'uds'::text AS area,
      i.area_operativa_id_snapshot AS area_operativa_id, NULL::integer AS centro_ascolto_id
      FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
      WHERE ${andSql(udsBaseConditions(filters))}
        AND ${udsEventDate} BETWEEN ${filters.da} AND ${filters.a}`);
  }
  return unions;
}

export async function buildGeneralReport(filters: ReportFilters) {
  const active = await activeSources(filters);
  const excludedSources = [];
  // Explicit query dimensions are not silently projected onto unrelated facts.
  const compatibility: Array<[boolean, string, Array<keyof ActiveSources>]> = [
    [
      filters.centroAscoltoId != null,
      "centroAscoltoId",
      ["pacchi", "sociale", "emporio", "mensa"],
    ],
    [
      filters.magazzinoId != null,
      "magazzinoId",
      ["pacchi", "emporio", "mensa"],
    ],
    [filters.mensaId != null, "mensaId", ["mensa"]],
    [filters.zonaMode === "query", "zonaUdsId", ["uds"]],
    [filters.tipoIntervento != null, "tipoIntervento", ["sociale", "uds"]],
    [filters.tipoServizio != null, "tipoServizio", ["mensa"]],
    [filters.operatoreId != null, "operatoreId", ["sociale", "mensa", "uds"]],
  ];
  for (const [selected, dimension, supported] of compatibility) {
    if (!selected) continue;
    for (const source of Object.keys(active) as Array<keyof ActiveSources>) {
      if (active[source] && !supported.includes(source)) {
        active[source] = false;
        excludedSources.push(text("sourceExcluded", { source, dimension }));
      }
    }
  }
  const [pacchi, sociale, emporio, mensa, uds] = await Promise.all([
    active.pacchi ? pacchiMetrics(filters) : null,
    active.sociale ? socialMetrics(filters) : null,
    active.emporio ? emporioMetrics(filters) : null,
    active.mensa ? mensaMetrics(filters) : null,
    active.uds ? udsMetrics(filters) : null,
  ]);
  const unions = eventUnions(filters, active);
  const eventRows = unions.length
    ? await rows<Record<string, unknown>>(sql`
        WITH eventi AS (${sql.join(unions, sql` UNION ALL `)})
        SELECT to_char(giorno, 'YYYY-MM') AS mese, area,
               COUNT(*) AS eventi, COUNT(DISTINCT beneficiario_id) AS persone
        FROM eventi GROUP BY 1, area ORDER BY 1, area
      `)
    : [];
  const uniqueRows = unions.length
    ? await rows<Record<string, unknown>>(sql`
        WITH eventi AS (${sql.join(unions, sql` UNION ALL `)})
        SELECT COUNT(DISTINCT beneficiario_id) AS persone FROM eventi
      `)
    : [];
  const geographicRows =
    unions.length &&
    filters.areaOperativaId == null &&
    filters.centroAscoltoId == null
      ? await rows<Record<string, unknown>>(sql`
        WITH eventi AS (${sql.join(unions, sql` UNION ALL `)})
        SELECT e.area_operativa_id, COALESCE(ao.nome, 'Senza area operativa') AS "areaOperativa",
               e.centro_ascolto_id, COALESCE(ca.nome, 'Senza centro') AS centro,
               COUNT(*) AS eventi, COUNT(DISTINCT e.beneficiario_id) AS persone
        FROM eventi e
        LEFT JOIN aree_operative ao ON ao.id = e.area_operativa_id
        LEFT JOIN centri_di_ascolto ca ON ca.id = e.centro_ascolto_id
        GROUP BY e.area_operativa_id, ao.nome, e.centro_ascolto_id, ca.nome
        ORDER BY eventi DESC, "areaOperativa", centro
      `)
      : [];

  const allKpi: ReportKpi[] = [
    kpi("personeUnicheComplessive", number(uniqueRows[0]?.persone)),
  ];
  if (pacchi) {
    allKpi.push(
      kpi("pacchiDistribuiti", pacchi.pacchi),
      kpi("nucleiPacchi", pacchi.nuclei),
    );
  }
  if (sociale) {
    allKpi.push(
      kpi("interventiCentroAscolto", sociale.interventi),
      kpi("personeCentroAscolto", sociale.persone),
    );
  }
  if (emporio) {
    allKpi.push(
      kpi("accessiEmporio", emporio.accessi),
      kpi("speseEmporio", emporio.spese),
      kpi("prodottiEmporio", emporio.prodottiDistinti),
      kpi("creditoUtilizzato", emporio.credito, "credit"),
    );
  }
  if (mensa) {
    allKpi.push(
      kpi("pastiErogati", mensa.pasti),
      kpi("utentiMensa", mensa.persone),
    );
  }
  if (uds) {
    allKpi.push(
      kpi("interventiUds", uds.interventi),
      kpi("personeUds", uds.persone),
    );
  }

  const byMonth = new Map<
    string,
    {
      label: string;
      value: number;
      secondaryValue: number;
      exactValue: string;
      exactSecondaryValue: string;
    }
  >();
  for (const row of eventRows) {
    const key = `${String(row.mese)}:${String(row.area)}`;
    byMonth.set(key, {
      label: key,
      value: number(row.eventi),
      secondaryValue: number(row.persone),
      exactValue: String(row.eventi),
      exactSecondaryValue: String(row.persone),
    });
  }
  const areaTable = Array.from(
    eventRows.reduce((map, row) => {
      const area = String(row.area);
      const current = map.get(area) ?? { eventi: 0n, personeMese: 0n };
      current.eventi += BigInt(String(row.eventi));
      current.personeMese += BigInt(String(row.persone));
      map.set(area, current);
      return map;
    }, new Map<string, { eventi: bigint; personeMese: bigint }>()),
  ).map(([area, values]) => ({
    area,
    eventi: values.eventi.toString(),
    personeMese: values.personeMese.toString(),
  }));

  return dashboard({
    section: "generale",
    filters,
    excludedSources,
    exactKpi: {
      personeUnicheComplessive: String(uniqueRows[0]?.persone ?? "0"),
      ...(pacchi
        ? {
            pacchiDistribuiti: pacchi.exact.pacchi,
            nucleiPacchi: pacchi.exact.nuclei,
          }
        : {}),
      ...(sociale
        ? {
            interventiCentroAscolto: sociale.exact.interventi,
            personeCentroAscolto: sociale.exact.persone,
          }
        : {}),
      ...(emporio
        ? {
            accessiEmporio: emporio.exact.accessi,
            speseEmporio: emporio.exact.spese,
            prodottiEmporio: emporio.exact.prodottiDistinti,
            creditoUtilizzato: emporio.exact.credito,
          }
        : {}),
      ...(mensa
        ? { pastiErogati: mensa.exact.pasti, utentiMensa: mensa.exact.persone }
        : {}),
      ...(uds
        ? { interventiUds: uds.exact.interventi, personeUds: uds.exact.persone }
        : {}),
    },
    kpi: allKpi,
    series: [
      { key: "attivitaPerMeseArea", points: Array.from(byMonth.values()) },
    ],
    tables: [
      {
        key: "confrontoAree",
        columns: ["area", "eventi", "personeMese"],
        rows: areaTable,
      },
      ...(geographicRows.length
        ? [
            {
              key: "distribuzioneTerritoriale",
              columns: [
                "areaOperativaId",
                "areaOperativa",
                "centroId",
                "centro",
                "eventi",
                "persone",
              ],
              rows: geographicRows.map((row) => ({
                areaOperativaId:
                  row.area_operativa_id == null
                    ? null
                    : number(row.area_operativa_id),
                areaOperativa: String(row.areaOperativa),
                centroId:
                  row.centro_ascolto_id == null
                    ? null
                    : number(row.centro_ascolto_id),
                centro: String(row.centro),
                eventi: String(row.eventi),
                persone: String(row.persone),
              })),
            },
          ]
        : []),
    ],
    definitions: [
      text("generalUniquePerson"),
      text("generalHouseholdMembers"),
      text("generalNoCrossAreaSum"),
    ],
  });
}
