import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";
import {
  effectiveBollaRigaId,
  fseDistributionNatureCondition,
  fseNetDistributedQuantity,
} from "./fseCanonicalFacts";

function pacchiConditions(filters: ReportFilters): SQL[] {
  return [
    sql`b.stato = 'consegnato'`,
    sql`NOT EXISTS (
      SELECT 1 FROM spese_emporio pacchi_se
      WHERE pacchi_se.bolla_id = b.id AND pacchi_se.stato_spesa = 'chiusa'
    )`,
    sql`b.data_bolla::date BETWEEN ${filters.da} AND ${filters.a}`,
    ...reportScope(filters, {
      areaOperativa: sql`COALESCE(b.area_operativa_id_snapshot, be.area_operativa_id)`,
      centro: sql`COALESCE(b.centro_ascolto_id_snapshot, be.centro_ascolto_id)`,
      magazzino: sql`b.magazzino_id`,
    }),
  ];
}

export async function pacchiMetrics(filters: ReportFilters) {
  const where = andSql(pacchiConditions(filters));
  const [totals] = await rows<Record<string, unknown>>(sql`
    SELECT COUNT(DISTINCT b.id) AS pacchi,
           COUNT(DISTINCT b.beneficiario_id) AS nuclei,
           COUNT(DISTINCT b.id) FILTER (WHERE c.tipo_consegna = 'domicilio') AS domiciliari,
           COUNT(DISTINCT b.id) FILTER (WHERE c.tipo_consegna IS DISTINCT FROM 'domicilio') AS sede
    FROM bolle b
    JOIN beneficiari be ON be.id = b.beneficiario_id
    LEFT JOIN consegne c ON c.id = b.consegna_id
    WHERE ${where}
  `);
  const [people] = await rows<Record<string, unknown>>(sql`
    WITH famiglie AS (
      SELECT DISTINCT ON (b.beneficiario_id) b.beneficiario_id,
             COALESCE(b.numero_componenti_nucleo_snapshot, be.num_componenti) AS numero_componenti
      FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      WHERE ${where}
      ORDER BY b.beneficiario_id, b.data_bolla DESC, b.id DESC
    )
    SELECT COALESCE(SUM(numero_componenti), 0) AS persone
    FROM famiglie
  `);
  return {
    pacchi: number(totals?.pacchi),
    nuclei: number(totals?.nuclei),
    persone: number(people?.persone),
    domiciliari: number(totals?.domiciliari),
    sede: number(totals?.sede),
  };
}

export async function buildPacchiReport(filters: ReportFilters) {
  const where = andSql(pacchiConditions(filters));
  const metrics = await pacchiMetrics(filters);
  const [monthly, products, centres, dataQuality] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT to_char(b.data_bolla::date, 'YYYY-MM') AS mese,
             COUNT(DISTINCT b.id) AS totale,
             COUNT(DISTINCT b.beneficiario_id) AS nuclei
      FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      WHERE ${where}
      GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      WITH consumo_lotti AS (
        SELECT ${effectiveBollaRigaId} AS bolla_riga_id,
               SUM(${fseNetDistributedQuantity(sql`mv.quantita`)}) AS quantita_totale,
               SUM(${fseNetDistributedQuantity(sql`mv.quantita`)})
                 FILTER (WHERE mv.fondo_origine = 'FSE_PLUS') AS quantita_fse,
               SUM(${fseNetDistributedQuantity(sql`mv.quantita`)})
                 FILTER (WHERE mv.fondo_origine <> 'FSE_PLUS') AS quantita_non_fse
        FROM movimenti mv
        LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
        WHERE ${effectiveBollaRigaId} IS NOT NULL
          AND ${fseDistributionNatureCondition}
        GROUP BY ${effectiveBollaRigaId}
      )
      SELECT p.id AS prodotto_id, p.nome AS prodotto_nome, br.unita_misura,
             SUM(COALESCE(cl.quantita_totale, 0)) AS quantita,
             SUM(COALESCE(cl.quantita_fse, 0)) AS quantita_fse,
             SUM(COALESCE(cl.quantita_non_fse, 0)) AS quantita_non_fse,
             COUNT(*) AS righe
      FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      JOIN bolla_righe br ON br.bolla_id = b.id
      JOIN prodotti p ON p.id = br.prodotto_id
      LEFT JOIN consumo_lotti cl ON cl.bolla_riga_id = br.id
      WHERE ${where}
      GROUP BY p.id, p.nome, br.unita_misura
      HAVING SUM(COALESCE(cl.quantita_totale, 0)) <> 0
      ORDER BY quantita DESC, p.nome
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(ca.nome, 'Senza centro') AS centro,
             COUNT(DISTINCT b.id) AS pacchi,
             COUNT(DISTINCT b.beneficiario_id) AS nuclei
      FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      LEFT JOIN centri_di_ascolto ca ON ca.id = COALESCE(b.centro_ascolto_id_snapshot, be.centro_ascolto_id)
      WHERE ${where}
      GROUP BY ca.id, ca.nome ORDER BY pacchi DESC, centro
    `),
    rows<Record<string, unknown>>(sql`
      WITH famiglie AS (
        SELECT DISTINCT be.id
        FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE ${where}
      ), qualita_nuclei AS (
        SELECT COUNT(*) FILTER (WHERE be.data_nascita IS NULL) AS nascita_mancante,
               COUNT(*) FILTER (WHERE be.sesso IS NULL OR trim(be.sesso) = '') AS sesso_mancante,
               COUNT(*) FILTER (WHERE be.num_componenti > 1 AND NOT EXISTS (
                 SELECT 1 FROM nucleo_familiare nf WHERE nf.beneficiario_id = be.id
               )) AS nucleo_incompleto
        FROM beneficiari be JOIN famiglie f ON f.id = be.id
      ), qualita_eventi AS (
        SELECT COUNT(DISTINCT b.id) FILTER (
                 WHERE b.area_operativa_id_snapshot IS NULL
                    OR b.centro_ascolto_id_snapshot IS NULL
               ) AS territorio_legacy,
               COUNT(DISTINCT b.id) FILTER (
                 WHERE b.numero_componenti_nucleo_snapshot IS NULL
               ) AS nucleo_storico_legacy,
               COUNT(DISTINCT b.id) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM movimenti mv
                 WHERE mv.bolla_id = b.id
                   OR mv.bolla_riga_id IN (
                     SELECT br.id FROM bolla_righe br WHERE br.bolla_id = b.id
                   )
               )) AS evento_senza_lineage
        FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE ${where}
      )
      SELECT qn.*, qe.* FROM qualita_nuclei qn CROSS JOIN qualita_eventi qe
    `),
  ]);

  const rowsTotal = products.reduce((sum, row) => sum + number(row.righe), 0);
  const distinctProducts = new Set(products.map((row) => number(row.prodotto_id))).size;
  const calculableKg = products.filter((row) => String(row.unita_misura).toLowerCase() === "kg").reduce((sum, row) => sum + number(row.quantita), 0);
  const dq = dataQuality[0] ?? {};

  return dashboard({
    section: "pacchi",
    filters,
    kpi: [kpi("pacchiDistribuiti", metrics.pacchi, "count", "pacchiDistribuiti"), kpi("nucleiServiti", metrics.nuclei, "count", "nucleiServiti"), kpi("personeRaggiunte", metrics.persone, "count", "personeRaggiunte"), kpi("distribuzioniSede", metrics.sede), kpi("distribuzioniDomiciliari", metrics.domiciliari), kpi("prodottiDistinti", distinctProducts), kpi("righeProdotto", rowsTotal), kpi("kgCalcolabili", calculableKg, "kg")],
    series: [
      {
        key: "pacchiPerMese",
        points: monthSeries(monthly, "totale", "nuclei"),
      },
    ],
    tables: [
      {
        key: "prodotti",
        columns: ["prodottoId", "prodottoNome", "unitaMisura", "righe", "quantita", "quantitaFse", "quantitaNonFse"],
        rows: products.map((row) => ({
          prodottoId: number(row.prodotto_id),
          prodottoNome: String(row.prodotto_nome),
          unitaMisura: String(row.unita_misura),
          righe: number(row.righe),
          quantita: number(row.quantita),
          quantitaFse: number(row.quantita_fse),
          quantitaNonFse: number(row.quantita_non_fse),
        })),
      },
      {
        key: "centri",
        columns: ["centro", "pacchi", "nuclei"],
        rows: centres.map((row) => ({
          centro: String(row.centro),
          pacchi: number(row.pacchi),
          nuclei: number(row.nuclei),
        })),
      },
    ],
    quality: [
      quality(
        "dataNascitaMancante",
        number(dq.nascita_mancante),
        number(dq.nascita_mancante) ? "derivable" : "ok",
      ),
      quality(
        "sessoMancante",
        number(dq.sesso_mancante),
        number(dq.sesso_mancante) ? "derivable" : "ok",
      ),
      quality(
        "nucleoIncompleto",
        number(dq.nucleo_incompleto),
        number(dq.nucleo_incompleto) ? "derivable" : "ok",
      ),
      quality(
        "territorioStoricoDerivato",
        number(dq.territorio_legacy),
        number(dq.territorio_legacy) ? "derivable" : "ok",
        "Territorio storico derivato dall'anagrafica corrente per Bolle legacy prive di snapshot.",
      ),
      quality(
        "nucleoStoricoDerivato",
        number(dq.nucleo_storico_legacy),
        number(dq.nucleo_storico_legacy) ? "derivable" : "ok",
        "Numero del nucleo derivato dall'anagrafica corrente per Bolle legacy prive di snapshot.",
      ),
      quality(
        "eventoSenzaLineage",
        number(dq.evento_senza_lineage),
        number(dq.evento_senza_lineage) ? "missing" : "ok",
        "Bolle distinte prive di Movimenti collegati al ledger canonico.",
      ),
    ],
    definitions: [
      "Pacco distribuito = bolla nello stato consegnato nel periodo non associata a una spesa Emporio chiusa.",
      "Nucleo servito = beneficiario distinto associato a una bolla consegnata.",
      "Persone raggiunte = snapshot del numero componenti del nucleo; il fallback legacy è segnalato come derivato.",
      "La quantità FSE+ deriva esclusivamente dai Movimenti e dal loro snapshot Fondo FSE_PLUS, al netto degli storni.",
      "Le quantità sono mostrate per prodotto e unità; soltanto i kg vengono aggregati nel KPI dedicato.",
    ],
  });
}

export { pacchiConditions };
