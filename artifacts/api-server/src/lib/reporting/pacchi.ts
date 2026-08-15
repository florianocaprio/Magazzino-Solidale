import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";

function pacchiConditions(filters: ReportFilters): SQL[] {
  return [
    sql`b.stato = 'consegnato'`,
    sql`b.data_bolla::date BETWEEN ${filters.da} AND ${filters.a}`,
    ...reportScope(filters, {
      citta: sql`be.citta_id`,
      centro: sql`be.centro_ascolto_id`,
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
      SELECT DISTINCT b.beneficiario_id
      FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      WHERE ${where}
    )
    SELECT COUNT(*) + COALESCE((
      SELECT COUNT(*) FROM nucleo_familiare nf
      JOIN famiglie f ON f.beneficiario_id = nf.beneficiario_id
    ), 0) AS persone
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
        SELECT mv.bolla_riga_id,
               SUM(abs(mv.quantita::numeric)) FILTER (WHERE l.fse_plus = true) AS quantita_fse
        FROM movimenti mv
        JOIN lotti l ON l.id = mv.lotto_id
        WHERE mv.bolla_riga_id IS NOT NULL AND mv.tipo_movimento = 'scarico'
        GROUP BY mv.bolla_riga_id
      )
      SELECT p.id AS prodotto_id, p.nome AS prodotto_nome, p.unita_misura,
             SUM(br.quantita::numeric) AS quantita,
             SUM(COALESCE(cl.quantita_fse, 0)) AS quantita_fse,
             SUM(br.quantita::numeric - COALESCE(cl.quantita_fse, 0)) AS quantita_non_fse
      FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      JOIN bolla_righe br ON br.bolla_id = b.id
      JOIN prodotti p ON p.id = br.prodotto_id
      LEFT JOIN consumo_lotti cl ON cl.bolla_riga_id = br.id
      WHERE ${where}
      GROUP BY p.id, p.nome, p.unita_misura
      ORDER BY quantita DESC, p.nome
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(ca.nome, 'Senza centro') AS centro,
             COUNT(DISTINCT b.id) AS pacchi,
             COUNT(DISTINCT b.beneficiario_id) AS nuclei
      FROM bolle b
      JOIN beneficiari be ON be.id = b.beneficiario_id
      LEFT JOIN centri_di_ascolto ca ON ca.id = be.centro_ascolto_id
      WHERE ${where}
      GROUP BY ca.id, ca.nome ORDER BY pacchi DESC, centro
    `),
    rows<Record<string, unknown>>(sql`
      WITH famiglie AS (
        SELECT DISTINCT be.id
        FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE ${where}
      )
      SELECT COUNT(*) FILTER (WHERE be.data_nascita IS NULL) AS nascita_mancante,
             COUNT(*) FILTER (WHERE be.sesso IS NULL OR trim(be.sesso) = '') AS sesso_mancante,
             COUNT(*) FILTER (WHERE be.num_componenti > 1 AND NOT EXISTS (
               SELECT 1 FROM nucleo_familiare nf WHERE nf.beneficiario_id = be.id
             )) AS nucleo_incompleto
      FROM beneficiari be JOIN famiglie f ON f.id = be.id
    `),
  ]);

  const quantityTotal = products.reduce((sum, row) => sum + number(row.quantita), 0);
  const fseTotal = products.reduce((sum, row) => sum + number(row.quantita_fse), 0);
  const nonFseTotal = products.reduce((sum, row) => sum + number(row.quantita_non_fse), 0);
  const dq = dataQuality[0] ?? {};

  return dashboard({
    section: "pacchi",
    filters,
    kpi: [
      kpi("pacchiDistribuiti", metrics.pacchi, "count", "pacchiDistribuiti"),
      kpi("nucleiServiti", metrics.nuclei, "count", "nucleiServiti"),
      kpi("personeRaggiunte", metrics.persone, "count", "personeRaggiunte"),
      kpi("distribuzioniSede", metrics.sede),
      kpi("distribuzioniDomiciliari", metrics.domiciliari),
      kpi("quantitaProdotti", quantityTotal, "quantity"),
      kpi("quantitaFse", fseTotal, "quantity", "prodottiFse"),
      kpi("quantitaNonFse", nonFseTotal, "quantity"),
    ],
    series: [{ key: "pacchiPerMese", points: monthSeries(monthly, "totale", "nuclei") }],
    tables: [
      {
        key: "prodotti",
        columns: ["prodottoId", "prodottoNome", "unitaMisura", "quantita", "quantitaFse", "quantitaNonFse"],
        rows: products.map((row) => ({
          prodottoId: number(row.prodotto_id),
          prodottoNome: String(row.prodotto_nome),
          unitaMisura: String(row.unita_misura),
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
      quality("dataNascitaMancante", number(dq.nascita_mancante), number(dq.nascita_mancante) ? "derivable" : "ok"),
      quality("sessoMancante", number(dq.sesso_mancante), number(dq.sesso_mancante) ? "derivable" : "ok"),
      quality("nucleoIncompleto", number(dq.nucleo_incompleto), number(dq.nucleo_incompleto) ? "derivable" : "ok"),
    ],
    definitions: [
      "Pacco distribuito = bolla nello stato consegnato nel periodo.",
      "Nucleo servito = beneficiario distinto associato a una bolla consegnata.",
      "Persone raggiunte = titolare più membri del nucleo registrati per i nuclei serviti.",
      "La quantità FSE+ deriva esclusivamente dai lotti effettivamente scaricati.",
    ],
  });
}

export { pacchiConditions };
