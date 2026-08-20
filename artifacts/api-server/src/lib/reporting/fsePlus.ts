import { sql, type SQL } from "drizzle-orm";
import { isModuloAttivo } from "../featureFlags";
import type { ReportFilters } from "./types";
import { reportingAgeBandSql } from "./ageBands";
import { andSql, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";

function fseScope(filters: ReportFilters) {
  return andSql(reportScope(filters, {
    areaOperativa: sql`be.area_operativa_id`,
    centro: sql`be.centro_ascolto_id`,
    magazzino: sql`b.magazzino_id`,
  }));
}

type FseSources = {
  pacchi: boolean;
  emporio: boolean;
  mensa: boolean;
};

async function activeFseSources(filters: ReportFilters): Promise<FseSources> {
  const [magazzino, bolle, emporio, mensa] = await Promise.all([
    isModuloAttivo("MAGAZZINO_SOLIDALE"),
    isModuloAttivo("BOLLE"),
    isModuloAttivo("EMPORIO_SOLIDALE"),
    isModuloAttivo("MENSA"),
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
  const sourceCondition = fseBollaSourceCondition({
    ...filters,
    callerAreas: [
      ...(sources.pacchi ? ["sociale"] : []),
      ...(sources.emporio ? ["emporio"] : []),
    ],
    callerIsAdmin: false,
  });
  const ageBand = reportingAgeBandSql(
    sql`persone.data_nascita`,
    sql`persone.fascia_eta_presunta`,
    filters.a,
  );
  const [products, channels, channelQuantities, people, ageRows, sexRows, qualityRows, packageMeals] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      WITH fse_movimenti AS (
        SELECT mv.bolla_riga_id, SUM(abs(mv.quantita::numeric)) AS quantita
        FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id
        WHERE mv.tipo_movimento = 'scarico' AND l.fse_plus = true
        GROUP BY mv.bolla_riga_id
      ), distribuzioni AS (
        SELECT p.id AS prodotto_id, p.nome AS prodotto_nome, br.unita_misura,
               COALESCE(fm.quantita, 0) AS quantita_fse,
               br.quantita::numeric AS quantita_totale_riga
        FROM bolla_righe br
        LEFT JOIN fse_movimenti fm ON fm.bolla_riga_id = br.id
        JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        JOIN prodotti p ON p.id = br.prodotto_id
        WHERE b.stato = 'consegnato'
          AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
          AND ${scope} AND ${sourceCondition}
      )
      SELECT prodotto_id, prodotto_nome, unita_misura,
             SUM(quantita_fse) AS quantita_fse,
             SUM(quantita_totale_riga) AS quantita_totale,
             CASE WHEN SUM(quantita_totale_riga) > 0
               THEN ROUND(SUM(quantita_fse) * 100 / SUM(quantita_totale_riga), 2)
               ELSE NULL END AS percentuale_fse,
             CASE WHEN unita_misura = 'kg' THEN SUM(quantita_fse) ELSE NULL END AS kg
      FROM distribuzioni
      GROUP BY prodotto_id, prodotto_nome, unita_misura
      HAVING SUM(quantita_fse) > 0
      ORDER BY quantita_fse DESC, prodotto_nome
    `),
    rows<Record<string, unknown>>(sql`
      WITH fse_movimenti AS (
        SELECT mv.bolla_riga_id, SUM(abs(mv.quantita::numeric)) AS quantita
        FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id
        WHERE mv.tipo_movimento = 'scarico' AND l.fse_plus = true
        GROUP BY mv.bolla_riga_id
      )
      SELECT CASE
               WHEN se.id IS NOT NULL THEN 'emporio'
               WHEN c.tipo_consegna = 'domicilio' THEN 'domiciliare'
               ELSE 'pacchi'
             END AS canale,
             COUNT(DISTINCT b.id) AS documenti,
             COUNT(DISTINCT b.beneficiario_id) AS nuclei
      FROM fse_movimenti fm
      JOIN bolla_righe br ON br.id = fm.bolla_riga_id
      JOIN bolle b ON b.id = br.bolla_id
      JOIN beneficiari be ON be.id = b.beneficiario_id
      LEFT JOIN spese_emporio se ON se.bolla_id = b.id AND se.stato_spesa = 'chiusa'
      LEFT JOIN consegne c ON c.id = b.consegna_id
      WHERE b.stato = 'consegnato' AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
        AND ${scope} AND ${sourceCondition}
      GROUP BY 1 ORDER BY documenti DESC, canale
    `),
    rows<Record<string, unknown>>(sql`
      WITH fse_movimenti AS (
        SELECT mv.bolla_riga_id, SUM(abs(mv.quantita::numeric)) AS quantita
        FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id
        WHERE mv.tipo_movimento = 'scarico' AND l.fse_plus = true
        GROUP BY mv.bolla_riga_id
      )
      SELECT CASE
               WHEN se.id IS NOT NULL THEN 'emporio'
               WHEN c.tipo_consegna = 'domicilio' THEN 'domiciliare'
               ELSE 'pacchi'
             END AS canale,
             br.unita_misura,
             SUM(fm.quantita) AS quantita
      FROM fse_movimenti fm
      JOIN bolla_righe br ON br.id = fm.bolla_riga_id
      JOIN bolle b ON b.id = br.bolla_id
      JOIN beneficiari be ON be.id = b.beneficiario_id
      LEFT JOIN spese_emporio se ON se.bolla_id = b.id AND se.stato_spesa = 'chiusa'
      LEFT JOIN consegne c ON c.id = b.consegna_id
      WHERE b.stato = 'consegnato' AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
        AND ${scope} AND ${sourceCondition}
      GROUP BY 1, br.unita_misura ORDER BY canale, br.unita_misura
    `),
    rows<Record<string, unknown>>(sql`
      WITH famiglie AS (
        SELECT DISTINCT b.beneficiario_id
        FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id AND l.fse_plus = true
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id
        JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND b.stato = 'consegnato'
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
        FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id AND l.fse_plus = true
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND b.stato = 'consegnato'
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
        FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id AND l.fse_plus = true
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND b.stato = 'consegnato'
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
        FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id AND l.fse_plus = true
        JOIN bolla_righe br ON br.id = mv.bolla_riga_id JOIN bolle b ON b.id = br.bolla_id
        JOIN beneficiari be ON be.id = b.beneficiario_id
        WHERE mv.tipo_movimento = 'scarico' AND b.stato = 'consegnato'
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
        ${sources.pacchi ? sql`(SELECT COUNT(DISTINCT b.id) FROM bolle b
          JOIN beneficiari be ON be.id = b.beneficiario_id
          WHERE b.stato = 'consegnato' AND b.data_bolla BETWEEN ${filters.da} AND ${filters.a}
            AND ${scope}
            AND NOT EXISTS (SELECT 1 FROM spese_emporio source_se
              WHERE source_se.bolla_id = b.id AND source_se.stato_spesa = 'chiusa'))` : sql`NULL`} AS pacchi,
        ${sources.mensa ? sql`(SELECT COUNT(*) FROM mensa_pasti mp JOIN mense m ON m.id = mp.mensa_id
          JOIN magazzini mg ON mg.id = m.magazzino_id
          WHERE mp.data_servizio BETWEEN ${filters.da} AND ${filters.a}
            AND ${andSql(reportScope(filters, { areaOperativa: sql`m.area_operativa_id`, centro: sql`mg.centro_ascolto_id` }))})` : sql`NULL`} AS pasti
    `),
  ]);
  const persons = people[0] ?? {};
  const dq = qualityRows[0] ?? {};
  const pp = packageMeals[0] ?? {};
  const distinctProducts = new Set(products.map((row) => number(row.prodotto_id))).size;
  const kg = products.reduce((sum, row) => sum + (row.kg == null ? 0 : number(row.kg)), 0);
  const unconvertible = products.filter((row) => row.kg == null).length;

  const availabilityRows = [
    ["Prodotti e quantità FSE+", "OK", "Lotti e movimenti", "Il lotto è autorevole"],
    ["Nuclei e persone raggiunte", "OK", "Bolle e nucleo familiare", "Titolare più membri registrati"],
    ["Sesso", "DERIVABILE", "Anagrafica", "Con controllo dei valori mancanti"],
    ["Fasce d'età", "DERIVABILE", "Data nascita/fascia presunta", `Reference date ${filters.a}`],
    ["Origine straniera/minoranze", "MANCANTE", "Nessuna fonte equivalente", "areaProvenienza non equivale alla definizione SIFEAD"],
    ["Disabilità individuale", "MANCANTE", "Solo aggregato familiare", "numDisabili non identifica persone"],
    ["Cittadini Paesi Terzi", "MANCANTE", "Nessuna classificazione normativa", "Extra-UE non viene reinterpretato"],
    ["Senzatetto/esclusione abitativa", "MANCANTE", "Nessun campo strutturato", "Le note libere non vengono analizzate"],
    ["Continuativo/saltuario", "MANCANTE", "Nessuna classificazione normativa", "Lo stato anagrafica non viene reinterpretato"],
    ["Misure di accompagnamento FSE+", "MANCANTE", "Tipi intervento non mappati FSE+", "Serve una decisione funzionale di mapping"],
    ["Prodotti FSE+ nei pasti Mensa", "MANCANTE", "Pasto non collegato a righe prodotto", "I trasferimenti alla Mensa non provano il consumo nel pasto"],
  ];

  return dashboard({
    section: "fse-plus",
    filters,
    kpi: [
      kpi("prodottiFseDistinti", distinctProducts, "count", "prodottiFseDistinti"),
      kpi("kgCalcolabili", kg, "kg"),
      kpi("nucleiRaggiunti", number(persons.nuclei), "count", "nucleiRaggiunti"),
      kpi("personeRaggiunte", number(persons.persone), "count", "personeRaggiunte"),
      ...(sources.pacchi ? [kpi("pacchiDistribuiti", number(pp.pacchi))] : []),
      ...(sources.mensa ? [kpi("pastiDistribuiti", number(pp.pasti))] : []),
    ],
    series: [{ key: "canali", points: channels.map((r) => ({ label: String(r.canale), value: number(r.documenti), secondaryValue: number(r.nuclei) })) }],
    tables: [
      { key: "01_Prodotti_FSE", columns: ["prodottoId", "prodottoNome", "unitaMisura", "quantitaFse", "quantitaTotale", "percentualeFse", "kg"], rows: products.map((r) => ({ prodottoId: number(r.prodotto_id), prodottoNome: String(r.prodotto_nome), unitaMisura: String(r.unita_misura), quantitaFse: number(r.quantita_fse), quantitaTotale: number(r.quantita_totale), percentualeFse: r.percentuale_fse == null ? null : number(r.percentuale_fse), kg: r.kg == null ? null : number(r.kg) })) },
      { key: "02_Continuativi", columns: ["stato", "nota"], rows: [{ stato: "MANCANTE", nota: "Classificazione continuativo non presente nel modello" }] },
      { key: "03_Saltuari_Mensa", columns: ["stato", "nota"], rows: [{ stato: "MANCANTE", nota: "Attribuzione FSE+ del singolo pasto non disponibile" }] },
      { key: "04_Saltuari_Pacchi", columns: ["stato", "nota"], rows: [{ stato: "MANCANTE", nota: "Classificazione saltuario non presente nel modello" }] },
      { key: "05_Saltuari_Strada", columns: ["stato", "nota"], rows: [{ stato: "MANCANTE", nota: "Gli interventi UDS non registrano una distribuzione FSE+ strutturata" }] },
      { key: "06_Pacchi_Pasti", columns: ["pacchi", "pasti"], rows: [{ pacchi: pp.pacchi == null ? null : number(pp.pacchi), pasti: pp.pasti == null ? null : number(pp.pasti) }] },
      { key: "07_Misure_Accompagnamento", columns: ["stato", "nota"], rows: [{ stato: "MANCANTE", nota: "Tipologie intervento non mappate a misure FSE+" }] },
      { key: "fasceEta", columns: ["fascia", "persone"], rows: ageRows.map((r) => ({ fascia: String(r.fascia), persone: number(r.persone) })) },
      { key: "sesso", columns: ["sesso", "persone"], rows: sexRows.map((r) => ({ sesso: String(r.sesso), persone: number(r.persone) })) },
      { key: "canali", columns: ["canale", "documenti", "nuclei"], rows: channels.map((r) => ({ canale: String(r.canale), documenti: number(r.documenti), nuclei: number(r.nuclei) })) },
      { key: "quantitaPerCanaleUnita", columns: ["canale", "unitaMisura", "quantita"], rows: channelQuantities.map((r) => ({ canale: String(r.canale), unitaMisura: String(r.unita_misura), quantita: number(r.quantita) })) },
      { key: "disponibilitaSifead", columns: ["campo", "disponibilita", "fonte", "note"], rows: availabilityRows.map(([campo, disponibilita, fonte, note]) => ({ campo, disponibilita, fonte, note })) },
    ],
    quality: [
      quality("sessoMancante", number(dq.sesso_mancante), number(dq.sesso_mancante) ? "missing" : "ok"),
      quality("dataNascitaMancante", number(dq.eta_mancante), number(dq.eta_mancante) ? "missing" : "ok"),
      quality("fasciaEtaPresuntaUsata", number(dq.fascia_presunta), number(dq.fascia_presunta) ? "derivable" : "ok"),
      quality("unitaPesoNonNormalizzabile", unconvertible, unconvertible ? "missing" : "ok", "Solo le quantità già espresse in kg confluiscono nei kg calcolabili."),
      quality("dimensioniSifeadMancanti", 6, "missing", "I campi mancanti sono esposti come non disponibili, mai come zero."),
    ],
    definitions: [
      "La provenienza FSE+ è determinata esclusivamente dal lotto movimentato.",
      "Una persona raggiunta è il titolare o un membro registrato di un nucleo con distribuzione FSE+.",
      `Le fasce d'età sono valutate alla data finale ${filters.a}.`,
      "Le celle SIFEAD non supportate dal modello restano MANCANTI e non assumono valore zero.",
      "Le sorgenti FSE+ sono incluse solo quando modulo, area e permessi del chiamante lo consentono.",
      "I canali sono confrontati per documenti e nuclei; le quantità restano separate per unità di misura.",
    ],
  });
}
