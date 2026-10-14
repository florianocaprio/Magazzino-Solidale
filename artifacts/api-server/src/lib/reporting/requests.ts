import { richiesteMagazzinoTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  canReadMensaRequests,
  m5bRequestScopePredicate,
  type M5bRequestActor,
} from "../m5bRequestAccess";
import { isReportModuleActive } from "./queryContext";
import { number, rows } from "./sql";
import { kpi, quality, text } from "./shared";
import type {
  ReportFilters,
  ReportKpi,
  ReportQualityItem,
  ReportTable,
  ReportText,
  ReportingDashboard,
} from "./types";

export type ReportPanel = {
  kpi: ReportKpi[];
  tables: ReportTable[];
  quality: ReportQualityItem[];
  definitions: ReportText[];
};
export const emptyReportPanel = (): ReportPanel => ({
  kpi: [],
  tables: [],
  quality: [],
  definitions: [],
});
export function appendReportPanels(
  report: ReportingDashboard,
  ...panels: ReportPanel[]
): ReportingDashboard {
  for (const panel of panels) {
    report.kpi.push(...panel.kpi);
    report.tables.push(...panel.tables);
    report.quality.push(...panel.quality);
    report.definitions.push(...panel.definitions);
  }
  return report;
}

export async function requestReportPanel(
  filters: ReportFilters,
  onlyMensa = false,
): Promise<ReportPanel> {
  const actor: M5bRequestActor = {
    id: filters.callerUserId,
    isAdmin: filters.callerIsAdmin,
    aree: filters.callerAreas,
    permessi: filters.callerPermissions,
    areaOperativaId: filters.areaOperativaId,
    centroAscoltoId: filters.centroAscoltoId,
    zonaUdsId: filters.zonaUdsId,
    mensaIds: filters.callerMensaIds,
  };
  if (
    !(await isReportModuleActive("MAGAZZINO_SOLIDALE")) ||
    (!actor.isAdmin &&
      !actor.permessi?.includes("richieste_magazzino.view") &&
      !canReadMensaRequests(actor))
  )
    return emptyReportPanel();
  const effective = sql`WITH authorized AS (
    SELECT * FROM ${richiesteMagazzinoTable} WHERE ${m5bRequestScopePredicate(actor)}
  ), facts AS (
    SELECT r.id, r.codice, r.stato, r.magazzino_richiesto_nome_snapshot AS preferenza,
      (r.data_creazione AT TIME ZONE 'Europe/Rome')::date AS inviata,
      COALESCE(b.stato, tr.stato) AS stato_documento,
      COALESCE(b.magazzino_id, tr.magazzino_origine_id) AS origine_id,
      mg.nome AS origine,
      (b.stato = 'consegnato' OR tr.stato IN ('confermato','completato')) AS ricevuta,
      CASE WHEN b.stato='consegnato' THEN COALESCE(c.data_effettuata::date, delivered.data_operativa)
        WHEN tr.stato IN ('confermato','completato') THEN tr.data_conferma_ricezione END AS ricevuta_il
    FROM authorized r
    LEFT JOIN richieste_magazzino_documenti link ON link.richiesta_id=r.id AND link.corrente=true
    LEFT JOIN bolle b ON b.id=link.bolla_id
    LEFT JOIN consegne c ON c.id=b.consegna_id AND c.stato='effettuata'
    LEFT JOIN LATERAL (
      SELECT ae.data_operativa FROM audit_eventi ae
      WHERE ae.azione='BOLLA_CONSEGNATA' AND ae.entita_tipo='bolla' AND ae.entita_id=b.id
        AND ae.documento_tipo='bolla' AND ae.documento_id=b.id
      ORDER BY ae.registrato_at DESC, ae.id DESC LIMIT 1
    ) delivered ON true
    LEFT JOIN trasferimenti tr ON tr.id=link.trasferimento_id
    LEFT JOIN magazzini mg ON mg.id=COALESCE(b.magazzino_id,tr.magazzino_origine_id)
    WHERE ${onlyMensa ? sql`r.mensa_id IS NOT NULL` : sql`true`}
      AND ${filters.mensaId == null ? sql`true` : sql`r.mensa_id = ${filters.mensaId}`}
      AND ${filters.magazzinoId == null ? sql`true` : sql`COALESCE(b.magazzino_id, tr.magazzino_origine_id) = ${filters.magazzinoId}`}
  )`;
  const [totals] = await rows<Record<string, string>>(sql`${effective}
    SELECT COUNT(*) FILTER (WHERE inviata BETWEEN ${filters.da} AND ${filters.a}) AS coorte,
      COUNT(*) FILTER (WHERE inviata BETWEEN ${filters.da} AND ${filters.a} AND stato='inviata') AS inviate,
      COUNT(*) FILTER (WHERE inviata BETWEEN ${filters.da} AND ${filters.a} AND stato='presa_in_carico') AS lavorazione,
      COUNT(*) FILTER (WHERE inviata BETWEEN ${filters.da} AND ${filters.a} AND stato='annullata') AS annullate,
      COUNT(*) FILTER (WHERE inviata BETWEEN ${filters.da} AND ${filters.a} AND ricevuta) AS coorte_ricevuta,
      COUNT(*) FILTER (WHERE ricevuta_il BETWEEN ${filters.da} AND ${filters.a}) AS forniture_periodo,
      COUNT(*) FILTER (WHERE inviata BETWEEN ${filters.da} AND ${filters.a} AND ricevuta AND ricevuta_il IS NULL) AS data_mancante
    FROM facts`);
  const details = await rows<
    Record<string, string | number | null>
  >(sql`${effective}
    SELECT id, codice, stato, stato_documento AS "statoDocumento", preferenza,
      origine_id AS "origineId", origine, inviata::text AS "dataInvio", ricevuta_il::text AS "dataRicezione"
    FROM facts WHERE inviata BETWEEN ${filters.da} AND ${filters.a}
    ORDER BY inviata DESC,id DESC LIMIT 200`);
  return {
    kpi: Object.entries({
      richiesteCoorte: "coorte",
      richiesteInviate: "inviate",
      richiesteInLavorazione: "lavorazione",
      richiesteAnnullate: "annullate",
      richiesteCoorteRicevute: "coorte_ricevuta",
      fornitureRicevutePeriodo: "forniture_periodo",
    }).map(([key, column]) =>
      kpi(key, number(totals[column]), "count", null, "ok", totals[column]),
    ),
    tables: [
      {
        key: "richiesteTop200",
        columns: [
          "codice",
          "dataInvio",
          "stato",
          "statoDocumento",
          "preferenza",
          "origine",
          "dataRicezione",
        ],
        rows: details,
      },
    ],
    quality: [
      quality(
        "ricezioneDataMancante",
        number(totals.data_mancante),
        number(totals.data_mancante) ? "missing" : "ok",
      ),
    ],
    definitions: [text("requestsCohort")],
  };
}
