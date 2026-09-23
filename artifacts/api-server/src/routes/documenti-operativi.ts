import { Router, type IRouter, type Request } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { isModuloAttivo } from "../lib/featureFlags";
import {
  buildDocumentiOperativiWorkbook,
  DOCUMENTI_OPERATIVI_XLSX_MIME,
  type DocumentoOperativoExportRow,
} from "../lib/documentiOperativiWorkbook";
import { isCivilDate } from "../lib/civilDate";
import {
  callerAreaOperativaId,
  callerCentroId,
  callerZonaUdsId,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import { buildDettaglio, canAccessBollaOperativa } from "./bolle";
import { getTrasferimentoWithRighe } from "./trasferimenti";

const router: IRouter = Router();

function hasPermission(req: Request, permission: string) {
  return Boolean(req.user?.isAdmin || req.user?.permessi?.includes(permission));
}

async function documentBranchAccess(req: Request) {
  const canRequestBolle = hasPermission(req, "bolle.view");
  const canRequestTransfers = hasPermission(req, "magazzino.view");
  const [magazzinoSolidaleAttivo, bolleAttivo, trasferimentiAttivo] =
    await Promise.all([
      canRequestBolle ? isModuloAttivo("MAGAZZINO_SOLIDALE") : false,
      canRequestBolle ? isModuloAttivo("BOLLE") : false,
      canRequestTransfers ? isModuloAttivo("TRASFERIMENTI") : false,
    ]);
  return {
    canReadBolle: canRequestBolle && magazzinoSolidaleAttivo && bolleAttivo,
    canReadTransfers: canRequestTransfers && trasferimentiAttivo,
  };
}

type DocumentFilters = {
  tipoAggregato: "bolla" | "trasferimento" | null;
  destinatario: "beneficiario" | "ente" | "magazzino" | null;
  stato: string | null;
  areaOperativaId: number | null;
  magazzinoId: number | null;
  centroAscoltoId: number | null;
  dataDa: string | null;
  dataA: string | null;
  ricerca: string | null;
  sortBy: "dataDocumento" | "dataCreazione" | "numero";
  sortDirection: "asc" | "desc";
};

type DocumentPagination = { page: number; limit: number };

type DocumentBranchAccess = Awaited<ReturnType<typeof documentBranchAccess>>;

type RawDocumentRow = Record<string, unknown>;

class DocumentQueryError extends Error {}

function stringQuery(req: Request, name: string): string | null {
  const value = req.query[name];
  if (value == null) return null;
  if (typeof value !== "string") throw new DocumentQueryError();
  return value;
}

function positiveIntegerQuery(
  req: Request,
  name: string,
  fallback: number | null = null,
): number | null {
  const value = stringQuery(req, name);
  if (value == null) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new DocumentQueryError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new DocumentQueryError();
  return parsed;
}

function enumQuery<T extends string>(
  req: Request,
  name: string,
  allowed: readonly T[],
  fallback: T | null = null,
): T | null {
  const value = stringQuery(req, name);
  if (value == null) return fallback;
  if (!allowed.includes(value as T)) throw new DocumentQueryError();
  return value as T;
}

function parseDocumentFilters(req: Request): DocumentFilters {
  const statoRaw = stringQuery(req, "stato");
  const stato = statoRaw?.trim() || null;
  if (statoRaw != null && (stato == null || stato.length > 40)) {
    throw new DocumentQueryError();
  }
  const dataDa = stringQuery(req, "dataDa");
  const dataA = stringQuery(req, "dataA");
  if (
    (dataDa != null && !isCivilDate(dataDa)) ||
    (dataA != null && !isCivilDate(dataA)) ||
    (dataDa != null && dataA != null && dataDa > dataA)
  ) {
    throw new DocumentQueryError();
  }
  const ricercaRaw = stringQuery(req, "ricerca");
  const ricerca = ricercaRaw?.trim() || null;
  if (ricercaRaw != null && (ricerca == null || ricerca.length > 120)) {
    throw new DocumentQueryError();
  }
  return {
    tipoAggregato: enumQuery(req, "tipoAggregato", [
      "bolla",
      "trasferimento",
    ] as const),
    destinatario: enumQuery(req, "destinatario", [
      "beneficiario",
      "ente",
      "magazzino",
    ] as const),
    stato,
    areaOperativaId: positiveIntegerQuery(req, "areaOperativaId"),
    magazzinoId: positiveIntegerQuery(req, "magazzinoId"),
    centroAscoltoId: positiveIntegerQuery(req, "centroAscoltoId"),
    dataDa,
    dataA,
    ricerca,
    sortBy:
      enumQuery(
        req,
        "sortBy",
        ["dataDocumento", "dataCreazione", "numero"] as const,
        "dataDocumento",
      ) ?? "dataDocumento",
    sortDirection:
      enumQuery(req, "sortDirection", ["asc", "desc"] as const, "desc") ??
      "desc",
  };
}

function parsePagination(req: Request): DocumentPagination {
  const page = positiveIntegerQuery(req, "page", 1) ?? 1;
  const limit = positiveIntegerQuery(req, "limit", 50) ?? 50;
  if (limit > 100) throw new DocumentQueryError();
  return { page, limit };
}

function orderBySql(filters: DocumentFilters) {
  if (filters.sortBy === "dataCreazione") {
    return filters.sortDirection === "asc"
      ? sql`data_creazione ASC, tipo_aggregato ASC, id DESC`
      : sql`data_creazione DESC, tipo_aggregato ASC, id DESC`;
  }
  if (filters.sortBy === "numero") {
    return filters.sortDirection === "asc"
      ? sql`lower(numero) ASC, numero ASC, tipo_aggregato ASC, id DESC`
      : sql`lower(numero) DESC, numero DESC, tipo_aggregato ASC, id DESC`;
  }
  return filters.sortDirection === "asc"
    ? sql`data_documento ASC, data_creazione ASC, tipo_aggregato ASC, id DESC`
    : sql`data_documento DESC, data_creazione DESC, tipo_aggregato ASC, id DESC`;
}

async function queryDocumentRows(
  req: Request,
  access: DocumentBranchAccess,
  filters: DocumentFilters,
  pagination: DocumentPagination | null,
): Promise<RawDocumentRow[]> {
  const centroId = callerCentroId(req);
  const areaId = callerAreaOperativaId(req);
  const zonaId = callerZonaUdsId(req);
  const visible = await visibleMagazzinoIds(centroId, areaId);
  const warehouseScope =
    visible == null
      ? sql`true`
      : visible.length
        ? sql`(origine_id IN (${sql.join(
            visible.map((id) => sql`${id}`),
            sql`, `,
          )}) OR destinazione_magazzino_id IN (${sql.join(
            visible.map((id) => sql`${id}`),
            sql`, `,
          )}))`
        : sql`false`;
  const paginationSql = pagination
    ? sql`LIMIT ${pagination.limit} OFFSET ${(pagination.page - 1) * pagination.limit}`
    : sql``;
  const totalSql = pagination
    ? sql`, count(*) OVER()::integer AS totale`
    : sql``;
  const rows = await db.execute(sql`
    WITH documenti AS (
      SELECT
        'bolla'::text AS tipo_aggregato,
        b.id,
        b.tipo_destinatario::text AS tipo_destinatario,
        b.numero_bolla::text AS numero,
        b.data_bolla::date AS data_documento,
        b.data_creazione AS data_creazione,
        b.stato::text AS stato,
        b.magazzino_id AS origine_id,
        NULL::integer AS destinazione_magazzino_id,
        m.area_operativa_id AS origine_area_id,
        NULL::integer AS destinazione_area_id,
        CASE WHEN b.tipo_destinatario = 'beneficiario'
          THEN ben.centro_ascolto_id
          ELSE NULL
        END::integer AS centro_ascolto_id,
        m.nome::text AS origine_nome,
        NULL::text AS destinazione_magazzino_nome,
        CASE WHEN b.tipo_destinatario = 'beneficiario'
          THEN concat_ws(' ', ben.cognome, ben.nome)
          ELSE COALESCE(ed.denominazione, b.destinatario_nome_snapshot)
        END::text AS destinatario_nome,
        b.versione::integer AS versione
      FROM bolle b
      LEFT JOIN beneficiari ben ON ben.id = b.beneficiario_id
      LEFT JOIN enti_destinatari ed ON ed.id = b.ente_destinatario_id
      LEFT JOIN magazzini m ON m.id = b.magazzino_id
      WHERE ${access.canReadBolle}
        AND (${centroId}::integer IS NULL OR b.tipo_destinatario = 'ente' OR ben.centro_ascolto_id = ${centroId})
        AND (${areaId}::integer IS NULL OR COALESCE(ben.area_operativa_id, b.area_operativa_id_snapshot) = ${areaId})
        AND (${zonaId}::integer IS NULL OR (b.tipo_destinatario = 'ente' AND ${areaId}::integer IS NOT NULL) OR (b.tipo_destinatario = 'beneficiario' AND ben.zona_uds_id = ${zonaId}))
      UNION ALL
      SELECT
        'trasferimento'::text,
        t.id,
        'magazzino'::text,
        t.codice::text,
        t.data_richiesta::date,
        t.data_creazione,
        t.stato::text,
        t.magazzino_origine_id,
        t.magazzino_destino_id,
        mo.area_operativa_id,
        md.area_operativa_id,
        NULL::integer,
        mo.nome::text,
        md.nome::text,
        md.nome::text,
        t.versione::integer
      FROM trasferimenti t
      LEFT JOIN magazzini mo ON mo.id = t.magazzino_origine_id
      LEFT JOIN magazzini md ON md.id = t.magazzino_destino_id
      WHERE ${access.canReadTransfers} AND t.mensa_id IS NULL
    ), filtrati AS (
      SELECT * FROM documenti
      WHERE ${warehouseScope}
        AND (${filters.tipoAggregato}::text IS NULL OR tipo_aggregato = ${filters.tipoAggregato})
        AND (${filters.areaOperativaId}::integer IS NULL OR origine_area_id = ${filters.areaOperativaId} OR destinazione_area_id = ${filters.areaOperativaId})
        AND (${filters.magazzinoId}::integer IS NULL OR origine_id = ${filters.magazzinoId} OR destinazione_magazzino_id = ${filters.magazzinoId})
        AND (${filters.centroAscoltoId}::integer IS NULL OR (tipo_aggregato = 'bolla' AND tipo_destinatario = 'beneficiario' AND centro_ascolto_id = ${filters.centroAscoltoId}))
        AND (${filters.destinatario}::text IS NULL OR tipo_destinatario = ${filters.destinatario})
        AND (${filters.stato}::text IS NULL OR documenti.stato = ${filters.stato})
        AND (${filters.dataDa}::date IS NULL OR data_documento >= ${filters.dataDa}::date)
        AND (${filters.dataA}::date IS NULL OR data_documento <= ${filters.dataA}::date)
        AND (${filters.ricerca}::text IS NULL
          OR strpos(lower(coalesce(numero, '')), lower(${filters.ricerca}::text)) > 0
          OR strpos(lower(coalesce(origine_nome, '')), lower(${filters.ricerca}::text)) > 0
          OR strpos(lower(coalesce(destinazione_magazzino_nome, '')), lower(${filters.ricerca}::text)) > 0)
    )
    SELECT *${totalSql}
    FROM filtrati
    ORDER BY ${orderBySql(filters)}
    ${paginationSql}
  `);
  return rows.rows as RawDocumentRow[];
}

function normalizeDocumentRow(row: RawDocumentRow) {
  return {
    documentoId: `${row.tipo_aggregato}:${row.id}`,
    tipoAggregato: String(row.tipo_aggregato),
    id: Number(row.id),
    tipoDestinatario: String(row.tipo_destinatario),
    numero: String(row.numero),
    dataDocumento: String(row.data_documento),
    dataCreazione: row.data_creazione,
    stato: String(row.stato),
    origineId: Number(row.origine_id),
    origineNome: row.origine_nome == null ? null : String(row.origine_nome),
    destinazioneMagazzinoId:
      row.destinazione_magazzino_id == null
        ? null
        : Number(row.destinazione_magazzino_id),
    destinazioneMagazzinoNome:
      row.destinazione_magazzino_nome == null
        ? null
        : String(row.destinazione_magazzino_nome),
    destinatarioNome:
      row.destinatario_nome == null ? null : String(row.destinatario_nome),
    versione: Number(row.versione),
  };
}

async function authorizedDocumentQuery(req: Request) {
  const access = await documentBranchAccess(req);
  if (!access.canReadBolle && !access.canReadTransfers) return null;
  return access;
}

router.get("/documenti-operativi", async (req, res) => {
  const access = await authorizedDocumentQuery(req);
  if (!access) {
    res.status(403).json({ error: "Permesso documenti non consentito" });
    return;
  }
  let filters: DocumentFilters;
  let pagination: DocumentPagination;
  try {
    filters = parseDocumentFilters(req);
    pagination = parsePagination(req);
  } catch (error) {
    if (!(error instanceof DocumentQueryError)) throw error;
    res.status(400).json({ error: "Filtri o paginazione non validi" });
    return;
  }
  const rows = await queryDocumentRows(req, access, filters, pagination);
  const normalized = rows.map(normalizeDocumentRow);
  const total = rows.length
    ? Number(rows[0].totale)
    : pagination.page > 1
      ? Number(
          (
            await queryDocumentRows(req, access, filters, {
              page: 1,
              limit: 1,
            })
          )[0]?.totale ?? 0,
        )
      : 0;
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(pagination.page));
  res.setHeader("X-Page-Size", String(pagination.limit));
  res.json({
    items: normalized,
    page: pagination.page,
    limit: pagination.limit,
    total,
  });
});

router.get("/documenti-operativi/export.xlsx", async (req, res) => {
  const access = await authorizedDocumentQuery(req);
  if (!access) {
    res.status(403).json({ error: "Permesso documenti non consentito" });
    return;
  }
  let filters: DocumentFilters;
  try {
    filters = parseDocumentFilters(req);
  } catch (error) {
    if (!(error instanceof DocumentQueryError)) throw error;
    res.status(400).json({ error: "Filtri non validi" });
    return;
  }
  const rows = await queryDocumentRows(req, access, filters, null);
  const normalized = rows.map(normalizeDocumentRow);
  const workbookRows: DocumentoOperativoExportRow[] = normalized.map((row) => ({
    documentoId: row.documentoId,
    tipoAggregato: row.tipoAggregato,
    numero: row.numero,
    dataDocumento: row.dataDocumento,
    tipoDestinatario: row.tipoDestinatario,
    destinatarioNome: row.destinatarioNome,
    origineNome: row.origineNome,
    destinazioneMagazzinoNome: row.destinazioneMagazzinoNome,
    stato: row.stato,
    versione: row.versione,
  }));
  res.setHeader("Content-Type", DOCUMENTI_OPERATIVI_XLSX_MIME);
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="documenti-operativi.xlsx"',
  );
  res.send(buildDocumentiOperativiWorkbook(workbookRows));
});

router.get("/documenti-operativi/:tipo/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identità documento non valida" });
    return;
  }
  const { canReadBolle, canReadTransfers } = await documentBranchAccess(req);
  if (req.params.tipo === "bolla") {
    if (!canReadBolle) {
      res.status(403).json({ error: "Permesso Bolle non consentito" });
      return;
    }
    const detail = await buildDettaglio(id);
    if (!detail) {
      res.status(404).json({ error: "Documento non trovato" });
      return;
    }
    if (
      !(await canAccessBollaOperativa(
        detail,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res.status(403).json({ error: "Documento non accessibile" });
      return;
    }
    res.json({
      documentoId: `bolla:${id}`,
      tipoAggregato: "bolla",
      dettaglio: detail,
    });
    return;
  }
  if (req.params.tipo === "trasferimento") {
    if (!canReadTransfers) {
      res.status(403).json({ error: "Permesso Magazzino non consentito" });
      return;
    }
    const detail = await getTrasferimentoWithRighe(id);
    if (!detail || detail.mensaId != null) {
      res.status(404).json({ error: "Documento non trovato" });
      return;
    }
    const visible = await visibleMagazzinoIds(
      callerCentroId(req),
      callerAreaOperativaId(req),
    );
    if (
      visible != null &&
      !visible.includes(detail.magazzinoOrigineId) &&
      !visible.includes(detail.magazzinoDestinoId)
    ) {
      res.status(403).json({ error: "Documento non accessibile" });
      return;
    }
    res.json({
      documentoId: `trasferimento:${id}`,
      tipoAggregato: "trasferimento",
      dettaglio: detail,
    });
    return;
  }
  res.status(400).json({ error: "Tipo documento non valido" });
});

export default router;
