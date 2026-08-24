import { sql, type SQL } from "drizzle-orm";
import type { ReportDrilldown, ReportFilters, ReportSection } from "./types";
import { REPORTING_MODEL_VERSION } from "./version";
import { ReportingError } from "./filters";
import { andSql, number, reportScope, rows } from "./sql";
import { pacchiConditions } from "./pacchi";
import { socialCompletedConditions, socialEventDate } from "./centroAscolto";
import { accessConditions, speseConditions } from "./emporio";
import { mealConditions, mensaAccessConditions } from "./mensa";
import { udsBaseConditions, udsEventDate } from "./uds";
import { movementConditions, transferCondition } from "./logistica";
import { fseAuthorizedMovementCondition } from "./fsePlus";
import {
  fseCanonicalPeriodCondition,
  fseNetDistributedQuantity,
} from "./fseCanonicalFacts";
import { authoritativeSnapshotOrderForAliasS } from "./fseSnapshotOrder";

type DetailDefinition = { columns: string[]; query: SQL };

const ALLOWED_METRICS: Record<ReportSection, Set<string>> = {
  generale: new Set(),
  pacchi: new Set([
    "pacchiDistribuiti",
    "nucleiServiti",
    "personeRaggiunte",
    "prodottiFse",
  ]),
  "centro-ascolto": new Set([
    "personePreseInCarico",
    "personeServite",
    "interventi",
  ]),
  emporio: new Set([
    "utentiServiti",
    "accessi",
    "speseConcluse",
    "prodottiDistribuiti",
    "prodottiDistintiDistribuiti",
  ]),
  mensa: new Set(["pastiErogati", "personeUniche", "accessiNegati"]),
  uds: new Set(["interventi", "personeUniche", "primiContatti"]),
  "magazzino-logistica": new Set([
    "movimentiCarico",
    "movimentiScarico",
    "trasferimenti",
  ]),
  "fse-plus": new Set([
    "prodottiFse",
    "prodottiFseDistinti",
    "nucleiRaggiunti",
    "personeRaggiunte",
  ]),
};

function detailDefinition(
  section: ReportSection,
  metric: string,
  filters: ReportFilters,
  limit: number,
  offset: number,
): DetailDefinition {
  if (!ALLOWED_METRICS[section].has(metric)) {
    throw new ReportingError(
      400,
      "Drill-down non disponibile per la metrica richiesta",
    );
  }
  const pagination = sql`LIMIT ${limit} OFFSET ${offset}`;
  if (section === "pacchi") {
    if (metric === "nucleiServiti") {
      return {
        columns: ["id", "beneficiarioCodice", "documenti", "data"],
        query: sql`
          SELECT be.id, be.codice AS beneficiario_codice,
                 COUNT(DISTINCT b.id) AS documenti, MAX(b.data_bolla)::text AS data,
                 COUNT(*) OVER() AS full_count
          FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
          WHERE ${andSql(pacchiConditions(filters))}
          GROUP BY be.id, be.codice ORDER BY data DESC, be.id DESC ${pagination}
        `,
      };
    }
    if (metric === "personeRaggiunte") {
      return {
        columns: ["id", "beneficiarioCodice", "tipo"],
        query: sql`
          WITH famiglie AS (
            SELECT DISTINCT be.id, be.codice
            FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
            WHERE ${andSql(pacchiConditions(filters))}
          ), persone AS (
            SELECT 'b-' || f.id::text AS id, f.codice AS beneficiario_codice, 'titolare'::text AS tipo FROM famiglie f
            UNION ALL
            SELECT 'n-' || nf.id::text, f.codice, 'componente'::text
            FROM famiglie f JOIN nucleo_familiare nf ON nf.beneficiario_id = f.id
          )
          SELECT id, beneficiario_codice, tipo, COUNT(*) OVER() AS full_count
          FROM persone ORDER BY beneficiario_codice, id ${pagination}
        `,
      };
    }
    if (metric === "prodottiFse") {
      return {
        columns: [
          "id",
          "data",
          "documento",
          "beneficiarioCodice",
          "prodotto",
          "lotto",
          "quantita",
          "unita",
        ],
        query: sql`
          SELECT mv.id, b.data_bolla::text AS data, b.numero_bolla AS documento,
                 be.codice AS beneficiario_codice, p.nome AS prodotto, l.codice_lotto AS lotto,
                 abs(mv.quantita::numeric) AS quantita, mv.unita_misura AS unita,
                 COUNT(*) OVER() AS full_count
          FROM movimenti mv JOIN lotti l ON l.id = mv.lotto_id
          JOIN bolla_righe br ON br.id = mv.bolla_riga_id JOIN bolle b ON b.id = br.bolla_id
          JOIN beneficiari be ON be.id = b.beneficiario_id JOIN prodotti p ON p.id = br.prodotto_id
          WHERE mv.tipo_movimento = 'scarico' AND mv.fondo_origine = 'FSE_PLUS'
            AND ${andSql(pacchiConditions(filters))}
          ORDER BY b.data_bolla DESC, mv.id DESC ${pagination}
        `,
      };
    }
    return {
      columns: [
        "id",
        "codice",
        "data",
        "beneficiarioCodice",
        "centro",
        "stato",
      ],
      query: sql`
        SELECT b.id, b.numero_bolla AS codice, b.data_bolla::text AS data,
               be.codice AS beneficiario_codice, ca.nome AS centro, b.stato,
               COUNT(*) OVER() AS full_count
        FROM bolle b JOIN beneficiari be ON be.id = b.beneficiario_id
        LEFT JOIN centri_di_ascolto ca ON ca.id = be.centro_ascolto_id
        WHERE ${andSql(pacchiConditions(filters))}
        ORDER BY b.data_bolla DESC, b.id DESC ${pagination}
      `,
    };
  }
  if (section === "centro-ascolto") {
    if (metric === "personeServite") {
      return {
        columns: ["id", "beneficiarioCodice", "interventi", "data"],
        query: sql`
          SELECT be.id, be.codice AS beneficiario_codice, COUNT(*) AS interventi,
                 MAX(${socialEventDate})::text AS data, COUNT(*) OVER() AS full_count
          FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
          WHERE ${andSql(socialCompletedConditions(filters))}
          GROUP BY be.id, be.codice ORDER BY data DESC, be.id DESC ${pagination}
        `,
      };
    }
    if (metric === "personePreseInCarico") {
      return {
        columns: ["id", "beneficiarioCodice", "data"],
        query: sql`
          SELECT be.id, be.codice AS beneficiario_codice, be.data_presa_in_carico::text AS data,
                 COUNT(*) OVER() AS full_count
          FROM beneficiari be
          WHERE be.data_presa_in_carico BETWEEN ${filters.da} AND ${filters.a}
            AND ${andSql(reportScope(filters, { areaOperativa: sql`be.area_operativa_id`, centro: sql`be.centro_ascolto_id`, zona: sql`be.zona_uds_id` }))}
          ORDER BY be.data_presa_in_carico DESC, be.id DESC ${pagination}
        `,
      };
    }
    return {
      columns: [
        "id",
        "beneficiarioCodice",
        "data",
        "tipo",
        "stato",
        "operatore",
      ],
      query: sql`
        SELECT i.id, be.codice AS beneficiario_codice, ${socialEventDate}::text AS data,
               i.tipo_intervento AS tipo, i.stato,
               COALESCE(u.matricola, u.username) AS operatore,
               COUNT(*) OVER() AS full_count
        FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
        LEFT JOIN utenti u ON u.id = i.operatore_id
        WHERE ${andSql(socialCompletedConditions(filters))}
        ORDER BY ${socialEventDate} DESC, i.id DESC ${pagination}
      `,
    };
  }
  if (section === "emporio" && metric === "accessi") {
    return {
      columns: ["id", "beneficiarioCodice", "data", "stato", "magazzino"],
      query: sql`
        SELECT c.id, be.codice AS beneficiario_codice,
               COALESCE(c.data_ora_effettiva_accesso::date, c.data_prevista)::text AS data,
               c.stato_accesso_emporio AS stato, mg.nome AS magazzino,
               COUNT(*) OVER() AS full_count
        FROM consegne c JOIN beneficiari be ON be.id = c.beneficiario_id
        LEFT JOIN magazzini mg ON mg.id = c.magazzino_emporio_id
        WHERE ${andSql(accessConditions(filters))}
        ORDER BY data DESC, c.id DESC ${pagination}
      `,
    };
  }
  if (section === "emporio" && metric === "utentiServiti") {
    return {
      columns: ["id", "beneficiarioCodice", "spese", "data"],
      query: sql`
        SELECT be.id, be.codice AS beneficiario_codice, COUNT(*) AS spese,
               MAX(se.data_chiusura)::text AS data, COUNT(*) OVER() AS full_count
        FROM spese_emporio se JOIN beneficiari be ON be.id = se.beneficiario_id
        WHERE ${andSql(speseConditions(filters))}
        GROUP BY be.id, be.codice ORDER BY data DESC, be.id DESC ${pagination}
      `,
    };
  }
  if (section === "emporio" && metric === "prodottiDistribuiti") {
    return {
      columns: [
        "id",
        "codice",
        "data",
        "beneficiarioCodice",
        "prodotto",
        "quantita",
        "credito",
      ],
      query: sql`
        SELECT ser.id, se.numero_spesa AS codice, se.data_chiusura::text AS data,
               be.codice AS beneficiario_codice, ser.descrizione_prodotto AS prodotto,
               ser.quantita::numeric AS quantita, ser.credito_totale::numeric AS credito,
               COUNT(*) OVER() AS full_count
        FROM spese_emporio se JOIN beneficiari be ON be.id = se.beneficiario_id
        JOIN spese_emporio_righe ser ON ser.spesa_emporio_id = se.id
        WHERE ${andSql(speseConditions(filters))}
        ORDER BY se.data_chiusura DESC, ser.id DESC ${pagination}
      `,
    };
  }
  if (section === "emporio" && metric === "prodottiDistintiDistribuiti") {
    return {
      columns: ["prodottoId", "codice", "prodotto", "unita", "righe", "spese"],
      query: sql`
        SELECT p.id AS prodotto_id, p.codice, p.nome AS prodotto,
               p.unita_misura AS unita, COUNT(ser.id) AS righe,
               COUNT(DISTINCT se.id) AS spese, COUNT(*) OVER() AS full_count
        FROM spese_emporio se
        JOIN spese_emporio_righe ser ON ser.spesa_emporio_id = se.id
        JOIN prodotti p ON p.id = ser.prodotto_id
        WHERE ${andSql(speseConditions(filters))}
        GROUP BY p.id, p.codice, p.nome, p.unita_misura
        ORDER BY p.nome, p.id ${pagination}
      `,
    };
  }
  if (section === "emporio") {
    return {
      columns: [
        "id",
        "codice",
        "data",
        "beneficiarioCodice",
        "credito",
        "stato",
      ],
      query: sql`
        SELECT se.id, se.numero_spesa AS codice, se.data_chiusura::text AS data,
               be.codice AS beneficiario_codice,
               se.totale_credito_consumati::numeric AS credito, se.stato_spesa AS stato,
               COUNT(*) OVER() AS full_count
        FROM spese_emporio se JOIN beneficiari be ON be.id = se.beneficiario_id
        WHERE ${andSql(speseConditions(filters))}
        ORDER BY se.data_chiusura DESC, se.id DESC ${pagination}
      `,
    };
  }
  if (section === "mensa" && metric === "accessiNegati") {
    return {
      columns: ["id", "data", "mensa", "motivo", "modalita"],
      query: sql`
        SELECT ma.id, (ma.data_ora AT TIME ZONE 'Europe/Rome')::text AS data,
               m.nome AS mensa, ma.motivo_esito AS motivo, ma.modalita_accesso AS modalita,
               COUNT(*) OVER() AS full_count
        FROM mensa_accessi ma JOIN mense m ON m.id = ma.mensa_id
        JOIN magazzini mg ON mg.id = m.magazzino_id
        WHERE ma.esito = 'negato' AND ${andSql(mensaAccessConditions(filters))}
        ORDER BY ma.data_ora DESC, ma.id DESC ${pagination}
      `,
    };
  }
  if (section === "mensa" && metric === "personeUniche") {
    return {
      columns: ["id", "beneficiarioCodice", "pasti", "data"],
      query: sql`
        SELECT be.id, be.codice AS beneficiario_codice, COUNT(*) AS pasti,
               MAX(mp.data_servizio)::text AS data, COUNT(*) OVER() AS full_count
        FROM mensa_pasti mp JOIN beneficiari be ON be.id = mp.beneficiario_id
        JOIN mense m ON m.id = mp.mensa_id JOIN magazzini mg ON mg.id = m.magazzino_id
        WHERE ${andSql(mealConditions(filters))}
        GROUP BY be.id, be.codice ORDER BY data DESC, be.id DESC ${pagination}
      `,
    };
  }
  if (section === "mensa") {
    return {
      columns: [
        "id",
        "data",
        "beneficiarioCodice",
        "mensa",
        "tipoServizio",
        "override",
      ],
      query: sql`
        SELECT mp.id, mp.data_servizio::text AS data, be.codice AS beneficiario_codice,
               m.nome AS mensa, mp.tipo_servizio, mp.override,
               COUNT(*) OVER() AS full_count
        FROM mensa_pasti mp JOIN beneficiari be ON be.id = mp.beneficiario_id
        JOIN mense m ON m.id = mp.mensa_id JOIN magazzini mg ON mg.id = m.magazzino_id
        WHERE ${andSql(mealConditions(filters))}
        ORDER BY mp.data_servizio DESC, mp.id DESC ${pagination}
      `,
    };
  }
  if (section === "uds") {
    if (metric === "personeUniche" || metric === "primiContatti") {
      const periodFilters: SQL[] = [
        sql`giorno BETWEEN ${filters.da} AND ${filters.a}`,
      ];
      if (
        filters.areaOperativaId != null &&
        filters.areaOperativaMode !== "all"
      ) {
        periodFilters.push(
          sql`area_operativa_id_snapshot = ${filters.areaOperativaId}`,
        );
      }
      if (filters.zonaUdsId != null && filters.zonaMode === "query") {
        periodFilters.push(sql`zona_uds_id_snapshot = ${filters.zonaUdsId}`);
      }
      if (filters.operatoreId != null)
        periodFilters.push(sql`operatore_id = ${filters.operatoreId}`);
      if (filters.tipoIntervento)
        periodFilters.push(
          sql`${filters.tipoIntervento} = ANY(regexp_split_to_array(tipo_intervento, '\s*,\s*'))`,
        );
      if (metric === "primiContatti") periodFilters.push(sql`numero = 1`);
      return {
        columns: ["id", "beneficiarioCodice", "data", "interventi"],
        query: sql`
          WITH sequenza AS (
            SELECT i.id, i.beneficiario_id, i.operatore_id, i.tipo_intervento,
                   i.area_operativa_id_snapshot, i.zona_uds_id_snapshot,
                   ${udsEventDate} AS giorno,
                   row_number() OVER (PARTITION BY i.beneficiario_id ORDER BY ${udsEventDate}, i.id) AS numero
            FROM interventi i
            WHERE i.ambito = 'uds'
          ), periodo AS (
            SELECT * FROM sequenza WHERE ${andSql(periodFilters)}
          )
          SELECT be.id, be.codice AS beneficiario_codice, MIN(p.giorno)::text AS data,
                 COUNT(*) AS interventi, COUNT(*) OVER() AS full_count
          FROM periodo p JOIN beneficiari be ON be.id = p.beneficiario_id
          GROUP BY be.id, be.codice ORDER BY data DESC, be.id DESC ${pagination}
        `,
      };
    }
    return {
      columns: [
        "id",
        "data",
        "beneficiarioCodice",
        "tipo",
        "zona",
        "operatore",
      ],
      query: sql`
        SELECT i.id, ${udsEventDate}::text AS data, be.codice AS beneficiario_codice,
               i.tipo_intervento AS tipo, z.nome AS zona,
               COALESCE(u.matricola, u.username) AS operatore,
               COUNT(*) OVER() AS full_count
        FROM interventi i JOIN beneficiari be ON be.id = i.beneficiario_id
        LEFT JOIN zone_uds z ON z.id = i.zona_uds_id_snapshot LEFT JOIN utenti u ON u.id = i.operatore_id
        WHERE ${andSql(udsBaseConditions(filters))}
          AND ${udsEventDate} BETWEEN ${filters.da} AND ${filters.a}
        ORDER BY ${udsEventDate} DESC, i.id DESC ${pagination}
      `,
    };
  }
  if (section === "magazzino-logistica" && metric === "trasferimenti") {
    return {
      columns: ["id", "codice", "data", "origine", "destinazione", "stato"],
      query: sql`
        SELECT tr.id, tr.codice, tr.data_richiesta::text AS data,
               mo.nome AS origine, md.nome AS destinazione, tr.stato,
               COUNT(*) OVER() AS full_count
        FROM trasferimenti tr JOIN magazzini mo ON mo.id = tr.magazzino_origine_id
        JOIN magazzini md ON md.id = tr.magazzino_destino_id
        WHERE tr.data_richiesta BETWEEN ${filters.da} AND ${filters.a}
          AND ${transferCondition(filters)}
        ORDER BY tr.data_richiesta DESC, tr.id DESC ${pagination}
      `,
    };
  }
  if (section === "magazzino-logistica") {
    const type = metric === "movimentiCarico" ? "carico" : "scarico";
    return {
      columns: [
        "id",
        "data",
        "tipo",
        "causale",
        "magazzino",
        "prodottoId",
        "quantita",
        "unita",
      ],
      query: sql`
        SELECT mv.id, mv.data_movimento::text AS data, mv.tipo_movimento AS tipo,
               mv.tipo_dettaglio AS causale, mg.nome AS magazzino,
               mv.prodotto_id, mv.quantita::numeric AS quantita, mv.unita_misura AS unita,
               COUNT(*) OVER() AS full_count
        FROM movimenti mv JOIN magazzini mg ON mg.id = mv.magazzino_id
        WHERE ${andSql(movementConditions(filters))} AND mv.tipo_movimento = ${type}
        ORDER BY mv.data_movimento DESC, mv.id DESC ${pagination}
      `,
    };
  }
  if (section === "fse-plus") {
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
    const authorizedMovement = fseAuthorizedMovementCondition(filters);
    const netDistributedQuantity = fseNetDistributedQuantity(sql`mv.quantita`);
    if (metric === "nucleiRaggiunti" || metric === "personeRaggiunte") {
      const peopleCte = sql`
        WITH famiglie AS (
          SELECT DISTINCT be.id, be.codice
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
          WHERE ${fseCanonicalPeriodCondition(filters, warehouseScope, authorizedMovement)}
            AND ${andSql(
              reportScope(filters, {
                areaOperativa: sql`COALESCE(b.area_operativa_id_snapshot, be.area_operativa_id)`,
                centro: sql`COALESCE(b.centro_ascolto_id_snapshot, be.centro_ascolto_id)`,
              }),
            )}
        ), profili AS (
          SELECT f.*, fs.numero_componenti, fs.donne, fs.uomini,
                 fs.eta_0_17, fs.eta_18_29, fs.eta_30_64, fs.eta_65_plus,
                 fs.data_riferimento, fs.origine_snapshot
          FROM famiglie f
          LEFT JOIN LATERAL (
            SELECT s.* FROM fse_fascicoli_sociali_snapshot s
            WHERE s.beneficiario_id = f.id AND s.data_riferimento <= ${filters.a}
            ORDER BY ${authoritativeSnapshotOrderForAliasS}
            LIMIT 1
          ) fs ON true
        )`;
      if (metric === "nucleiRaggiunti") {
        return {
          columns: [
            "id",
            "beneficiarioCodice",
            "dataRiferimento",
            "origineSnapshot",
            "numeroComponenti",
          ],
          query: sql`${peopleCte}
            SELECT id, codice AS beneficiario_codice, data_riferimento,
                   origine_snapshot, numero_componenti, COUNT(*) OVER() AS full_count
            FROM profili ORDER BY codice, id ${pagination}`,
        };
      }
      return {
        columns: [
          "id",
          "beneficiarioCodice",
          "persone",
          "donne",
          "uomini",
          "eta017",
          "eta1829",
          "eta3064",
          "eta65Plus",
          "dataRiferimento",
        ],
        query: sql`${peopleCte}
          SELECT id, codice AS beneficiario_codice, numero_componenti AS persone,
                 donne, uomini, eta_0_17, eta_18_29, eta_30_64, eta_65_plus,
                 data_riferimento, COUNT(*) OVER() AS full_count
          FROM profili ORDER BY codice, id ${pagination}`,
      };
    }
    if (metric === "prodottiFseDistinti") {
      return {
        columns: [
          "prodottoId",
          "codice",
          "prodotto",
          "unita",
          "documenti",
          "lotti",
          "movimenti",
          "quantitaNetta",
        ],
        query: sql`
          SELECT p.id AS prodotto_id, p.codice, p.nome AS prodotto,
                 string_agg(DISTINCT mv.unita_misura, ', ' ORDER BY mv.unita_misura) AS unita,
                 COUNT(DISTINCT COALESCE(mv.documento_riferimento, op.numero_documento)) AS documenti,
                 COUNT(DISTINCT l.id) AS lotti,
                 COUNT(DISTINCT mv.id) AS movimenti,
                 SUM(${netDistributedQuantity}) AS quantita_netta,
                 COUNT(*) OVER() AS full_count
          FROM movimenti mv
          LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
          LEFT JOIN lotti l ON l.id = mv.lotto_id
          LEFT JOIN operazioni_distribuzione_magazzino op ON op.id = COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id)
          JOIN prodotti p ON p.id = mv.prodotto_id
          JOIN magazzini mg ON mg.id = mv.magazzino_id
          WHERE ${fseCanonicalPeriodCondition(filters, warehouseScope, authorizedMovement)}
          GROUP BY p.id, p.codice, p.nome
          HAVING SUM(${netDistributedQuantity}) <> 0
          ORDER BY p.nome, p.id ${pagination}
        `,
      };
    }
    return {
      columns: [
        "id",
        "data",
        "documento",
        "prodotto",
        "lotto",
        "quantita",
        "unita",
        "fondo",
        "naturaContabile",
        "canale",
        "stato",
        "operazioneDistribuzioneId",
        "movimentoOriginaleId",
        "qualita",
      ],
      query: sql`
        SELECT mv.id, mv.data_movimento::text AS data,
               COALESCE(mv.documento_riferimento, op.numero_documento) AS documento,
               p.nome AS prodotto, l.codice_lotto AS lotto,
               ${netDistributedQuantity} AS quantita,
               mv.unita_misura AS unita,
               mv.fondo_origine AS fondo, mv.natura_contabile,
               COALESCE(mv.canale_operativo, original.canale_operativo, 'NON_CLASSIFICATO') AS canale,
               op.stato, op.id AS operazione_distribuzione_id,
               mv.movimento_origine_id AS movimento_originale_id,
               ARRAY_REMOVE(ARRAY[
                 CASE WHEN COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id) IS NULL THEN 'OPERAZIONE_MANCANTE' END,
                 CASE WHEN COALESCE(mv.canale_operativo, original.canale_operativo) IS NULL THEN 'CANALE_NON_CLASSIFICATO' END,
                 CASE WHEN mv.lotto_id IS NULL THEN 'LOTTO_MANCANTE' END
               ], NULL) AS qualita,
               COUNT(*) OVER() AS full_count
        FROM movimenti mv
        LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
        LEFT JOIN lotti l ON l.id = mv.lotto_id
        LEFT JOIN operazioni_distribuzione_magazzino op ON op.id = COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id)
        JOIN prodotti p ON p.id = mv.prodotto_id
        JOIN magazzini mg ON mg.id = mv.magazzino_id
        WHERE ${fseCanonicalPeriodCondition(filters, warehouseScope, authorizedMovement)}
        ORDER BY mv.data_movimento DESC, mv.id DESC ${pagination}
      `,
    };
  }
  throw new ReportingError(
    400,
    "Drill-down non disponibile per la metrica richiesta",
  );
}

export async function buildDrilldown(input: {
  section: ReportSection;
  metric: string;
  filters: ReportFilters;
  page: number;
  pageSize: number;
}): Promise<ReportDrilldown> {
  const definition = detailDefinition(
    input.section,
    input.metric,
    input.filters,
    input.pageSize,
    (input.page - 1) * input.pageSize,
  );
  const result = await rows<Record<string, unknown>>(definition.query);
  return {
    reportingModelVersion: REPORTING_MODEL_VERSION,
    section: input.section,
    metric: input.metric,
    page: input.page,
    pageSize: input.pageSize,
    total: number(result[0]?.full_count),
    columns: definition.columns,
    rows: result.map(({ full_count: _fullCount, ...row }) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          value == null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
            ? (value ?? null)
            : String(value),
        ]),
      ),
    ),
  };
}
