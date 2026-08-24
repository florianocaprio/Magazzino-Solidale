import { sql, type SQL } from "drizzle-orm";
import type { ReportFilters } from "./types";
import { andSql, monthSeries, number, reportScope, rows } from "./sql";
import { dashboard, kpi, quality } from "./shared";
import {
  effectiveBollaRigaId,
  fseDistributionNatureCondition,
  fseNetDistributedQuantity,
} from "./fseCanonicalFacts";

function speseConditions(filters: ReportFilters): SQL[] {
  return [
    sql`se.stato_spesa = 'chiusa'`,
    sql`se.data_chiusura::date BETWEEN ${filters.da} AND ${filters.a}`,
    ...reportScope(filters, {
      areaOperativa: sql`se.area_operativa_id`,
      centro: sql`se.centro_ascolto_id`,
      magazzino: sql`se.magazzino_emporio_id`,
    }),
  ];
}

function accessConditions(filters: ReportFilters): SQL[] {
  return [
    sql`c.tipo_pianificazione = 'accesso_emporio'`,
    sql`c.stato_accesso_emporio = 'effettuato'`,
    sql`COALESCE(c.data_ora_effettiva_accesso::date, c.data_prevista) BETWEEN ${filters.da} AND ${filters.a}`,
    ...reportScope(filters, {
      areaOperativa: sql`COALESCE(c.area_operativa_id_snapshot, be.area_operativa_id)`,
      centro: sql`COALESCE(c.centro_ascolto_id_snapshot, be.centro_ascolto_id)`,
      magazzino: sql`c.magazzino_emporio_id`,
    }),
  ];
}

export async function emporioMetrics(filters: ReportFilters) {
  const speseWhere = andSql(speseConditions(filters));
  const accessWhere = andSql(accessConditions(filters));
  const scopeBeneficiari = andSql(
    reportScope(filters, {
      areaOperativa: sql`be.area_operativa_id`,
      centro: sql`be.centro_ascolto_id`,
    }),
  );
  const [spese, accessi, enabled, stock] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS spese,
             COUNT(DISTINCT se.beneficiario_id) AS utenti,
             COALESCE(SUM(se.totale_credito_consumati::numeric), 0) AS credito,
             COALESCE(AVG(se.totale_credito_consumati::numeric), 0) AS credito_medio,
             COALESCE((
               WITH movimenti_distribuzione AS (
                 SELECT ${effectiveBollaRigaId} AS bolla_riga_id,
                        SUM(${fseNetDistributedQuantity(sql`mv.quantita`)}) AS quantita_totale
                 FROM movimenti mv
                 LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
                 WHERE ${effectiveBollaRigaId} IS NOT NULL
                   AND ${fseDistributionNatureCondition}
                 GROUP BY ${effectiveBollaRigaId}
               )
               SELECT COUNT(*) FROM (
                 SELECT ser.prodotto_id
                 FROM spese_emporio se3
                 JOIN spese_emporio_righe ser ON ser.spesa_emporio_id = se3.id
                 JOIN movimenti_distribuzione md ON md.bolla_riga_id = ser.bolla_riga_id
                 WHERE se3.stato_spesa = 'chiusa'
                   AND se3.data_chiusura::date BETWEEN ${filters.da} AND ${filters.a}
                   AND ${andSql(
                     reportScope(filters, {
                       areaOperativa: sql`se3.area_operativa_id`,
                       centro: sql`se3.centro_ascolto_id`,
                       magazzino: sql`se3.magazzino_emporio_id`,
                     }),
                   )}
                 GROUP BY ser.prodotto_id
                 HAVING SUM(md.quantita_totale) <> 0
               ) prodotti_netti
             ), 0) AS prodotti_distinti
      FROM spese_emporio se WHERE ${speseWhere}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS accessi FROM consegne c
      JOIN beneficiari be ON be.id = c.beneficiario_id
      WHERE ${accessWhere}
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) AS abilitati,
             COALESCE(SUM(be.credito_solidale_saldo::numeric), 0) AS saldo
      FROM beneficiari be
      WHERE be.credito_solidale_abilitato = true
        AND be.credito_solidale_stato = 'attivo'
        AND ${scopeBeneficiari}
    `),
    rows<Record<string, unknown>>(sql`
      WITH stock AS (
        SELECT l.magazzino_id, l.prodotto_id, SUM(l.quantita_residua::numeric) AS quantita
        FROM lotti l
        JOIN magazzini mg ON mg.id = l.magazzino_id
        WHERE mg.tipo_magazzino IN ('emporio', 'misto')
          AND mg.stato = 'attivo'
          AND ${andSql(
            reportScope(filters, {
              areaOperativa: sql`mg.area_operativa_id`,
              centro: sql`mg.centro_ascolto_id`,
              magazzino: sql`mg.id`,
            }),
          )}
        GROUP BY l.magazzino_id, l.prodotto_id
      )
      SELECT COUNT(*) FILTER (WHERE stock.quantita > 0) AS prodotti_giacenza,
             COUNT(*) FILTER (WHERE stock.quantita <= p.scorta_minima::numeric) AS sotto_scorta
      FROM stock JOIN prodotti p ON p.id = stock.prodotto_id
    `),
  ]);
  const s = spese[0] ?? {};
  const a = accessi[0] ?? {};
  const e = enabled[0] ?? {};
  const st = stock[0] ?? {};
  return {
    abilitati: number(e.abilitati),
    utenti: number(s.utenti),
    accessi: number(a.accessi),
    spese: number(s.spese),
    prodottiDistinti: number(s.prodotti_distinti),
    credito: number(s.credito),
    creditoMedio: number(s.credito_medio),
    saldo: number(e.saldo),
    prodottiGiacenza: number(st.prodotti_giacenza),
    sottoScorta: number(st.sotto_scorta),
  };
}

export async function buildEmporioReport(filters: ReportFilters) {
  const where = andSql(speseConditions(filters));
  const metrics = await emporioMetrics(filters);
  const [monthly, products, centres, frequency, dqRows] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      SELECT to_char(se.data_chiusura::date, 'YYYY-MM') AS mese,
             COUNT(*) AS totale,
             COALESCE(SUM(se.totale_credito_consumati::numeric), 0) AS credito
      FROM spese_emporio se WHERE ${where}
      GROUP BY 1 ORDER BY 1
    `),
    rows<Record<string, unknown>>(sql`
      WITH movimenti_distribuzione AS (
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
      SELECT p.id AS prodotto_id, p.nome AS prodotto_nome, p.unita_misura,
             COALESCE(SUM(md.quantita_totale), 0) AS quantita,
             COALESCE(SUM(md.quantita_fse), 0) AS quantita_fse,
             COALESCE(SUM(md.quantita_non_fse), 0) AS quantita_non_fse
      FROM spese_emporio se
      JOIN spese_emporio_righe ser ON ser.spesa_emporio_id = se.id
      JOIN prodotti p ON p.id = ser.prodotto_id
      JOIN movimenti_distribuzione md ON md.bolla_riga_id = ser.bolla_riga_id
      WHERE ${where}
      GROUP BY p.id, p.nome, p.unita_misura
      HAVING SUM(md.quantita_totale) <> 0
      ORDER BY quantita DESC, p.nome
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COALESCE(ca.nome, 'Senza centro') AS centro,
             COUNT(*) AS spese,
             COUNT(DISTINCT se.beneficiario_id) AS utenti,
             COALESCE(SUM(se.totale_credito_consumati::numeric), 0) AS credito
      FROM spese_emporio se
      LEFT JOIN centri_di_ascolto ca ON ca.id = se.centro_ascolto_id
      WHERE ${where}
      GROUP BY ca.id, ca.nome ORDER BY spese DESC, centro
    `),
    rows<Record<string, unknown>>(sql`
      SELECT be.codice AS beneficiario_codice, COUNT(*) AS spese
      FROM spese_emporio se JOIN beneficiari be ON be.id = se.beneficiario_id
      WHERE ${where}
      GROUP BY be.id, be.codice ORDER BY spese DESC, be.codice LIMIT 50
    `),
    rows<Record<string, unknown>>(sql`
      SELECT COUNT(*) FILTER (WHERE ser.lotto_id IS NULL) AS lotto_mancante,
             COUNT(*) FILTER (WHERE se.centro_ascolto_id IS NULL) AS centro_mancante
      FROM spese_emporio se
      JOIN spese_emporio_righe ser ON ser.spesa_emporio_id = se.id
      WHERE ${where}
    `),
  ]);
  const dq = dqRows[0] ?? {};

  return dashboard({
    section: "emporio",
    filters,
    kpi: [kpi("utentiAbilitatiCredito", metrics.abilitati), kpi("utentiServiti", metrics.utenti, "count", "utentiServiti"), kpi("accessi", metrics.accessi, "count", "accessi"), kpi("speseConcluse", metrics.spese, "count", "speseConcluse"), kpi("prodottiDistintiDistribuiti", metrics.prodottiDistinti, "count", "prodottiDistintiDistribuiti"), kpi("creditoUtilizzato", metrics.credito, "credit"), kpi("creditoMedioSpesa", metrics.creditoMedio, "credit"), kpi("saldoResiduo", metrics.saldo, "credit"), kpi("prodottiInGiacenza", metrics.prodottiGiacenza), kpi("prodottiSottoScorta", metrics.sottoScorta)],
    series: [
      {
        key: "spesePerMese",
        points: monthSeries(monthly, "totale", "credito"),
      },
    ],
    tables: [
      {
        key: "prodotti",
        columns: ["prodottoId", "prodottoNome", "unitaMisura", "quantita", "quantitaFse", "quantitaNonFse"],
        rows: products.map((r) => ({
          prodottoId: number(r.prodotto_id),
          prodottoNome: String(r.prodotto_nome),
          unitaMisura: String(r.unita_misura),
          quantita: number(r.quantita),
          quantitaFse: number(r.quantita_fse),
          quantitaNonFse: number(r.quantita_non_fse),
        })),
      },
      {
        key: "centri",
        columns: ["centro", "spese", "utenti", "credito"],
        rows: centres.map((r) => ({
          centro: String(r.centro),
          spese: number(r.spese),
          utenti: number(r.utenti),
          credito: number(r.credito),
        })),
      },
      {
        key: "frequenza",
        columns: ["beneficiarioCodice", "spese"],
        rows: frequency.map((r) => ({
          beneficiarioCodice: String(r.beneficiario_codice),
          spese: number(r.spese),
        })),
      },
    ],
    quality: [quality("lottoMancante", number(dq.lotto_mancante), number(dq.lotto_mancante) ? "derivable" : "ok", "Senza lotto non è possibile attribuire con certezza la provenienza FSE+."), quality("centroMancante", number(dq.centro_mancante), number(dq.centro_mancante) ? "derivable" : "ok")],
    definitions: ["Spesa Emporio = record spese_emporio nello stato chiusa.", "Prodotti distinti distribuiti = prodotti con quantità netta diversa da zero nel ledger canonico delle spese chiuse.", "Utente servito = beneficiario distinto con almeno una spesa chiusa nel periodo.", "La provenienza FSE+ deriva dallo snapshot Fondo dei Movimenti della spesa.", "Le quantità restano separate per prodotto e unità di misura e non vengono sommate tra unità eterogenee."],
  });
}

export { speseConditions, accessConditions };
