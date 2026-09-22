export type DocumentoOperativoTipo = "bolla" | "trasferimento";
export type DocumentoOperativoDestinatario =
  | "beneficiario"
  | "ente"
  | "magazzino";
export type DocumentoOperativoSort =
  | "dataDocumento"
  | "dataCreazione"
  | "numero";
export type DocumentoOperativoSortDirection = "asc" | "desc";

export type DocumentoOperativoFilters = {
  tipoAggregato: "all" | DocumentoOperativoTipo;
  destinatario: "all" | DocumentoOperativoDestinatario;
  stato: string;
  areaOperativaId: string;
  magazzinoId: string;
  centroAscoltoId: string;
  dataDa: string;
  dataA: string;
  ricerca: string;
  sortBy: DocumentoOperativoSort;
  sortDirection: DocumentoOperativoSortDirection;
};

export type DocumentoOperativoSelection = {
  tipo: DocumentoOperativoTipo;
  id: number;
};

export const DEFAULT_DOCUMENTO_FILTERS: DocumentoOperativoFilters = {
  tipoAggregato: "all",
  destinatario: "all",
  stato: "all",
  areaOperativaId: "all",
  magazzinoId: "all",
  centroAscoltoId: "all",
  dataDa: "",
  dataA: "",
  ricerca: "",
  sortBy: "dataDocumento",
  sortDirection: "desc",
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function enumValue<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value != null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function positiveId(value: string | null): string {
  if (value == null || !/^[1-9]\d*$/.test(value)) return "all";
  if (!Number.isSafeInteger(Number(value))) return "all";
  return value;
}

function dateValue(value: string | null): string {
  return value != null && datePattern.test(value) ? value : "";
}

export function parseDocumentoSelection(
  value: string | null,
): DocumentoOperativoSelection | null {
  const match = /^(bolla|trasferimento):([1-9]\d*)$/.exec(value ?? "");
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id)) return null;
  return {
    tipo: match[1] as DocumentoOperativoTipo,
    id,
  };
}

export function documentoSelectionValue(
  selection: DocumentoOperativoSelection,
): string {
  return `${selection.tipo}:${selection.id}`;
}

export function readDocumentiOperativiUrl(search: string): {
  filters: DocumentoOperativoFilters;
  selection: DocumentoOperativoSelection | null;
  page: number;
} {
  const params = new URLSearchParams(search);
  const canonicalSelection = parseDocumentoSelection(params.get("documento"));
  const legacyBolla = positiveId(params.get("bollaId"));
  const legacyTransfer = positiveId(params.get("trasferimentoId"));
  const selection =
    canonicalSelection ??
    (legacyBolla !== "all"
      ? { tipo: "bolla" as const, id: Number(legacyBolla) }
      : legacyTransfer !== "all"
        ? { tipo: "trasferimento" as const, id: Number(legacyTransfer) }
        : null);
  const parsedPage = Number(params.get("page"));

  return {
    filters: {
      tipoAggregato: enumValue(
        params.get("tipoAggregato"),
        ["all", "bolla", "trasferimento"] as const,
        "all",
      ),
      destinatario: enumValue(
        params.get("destinatario"),
        ["all", "beneficiario", "ente", "magazzino"] as const,
        "all",
      ),
      stato: params.get("stato")?.trim() || "all",
      areaOperativaId: positiveId(params.get("areaOperativaId")),
      magazzinoId: positiveId(params.get("magazzinoId")),
      centroAscoltoId: positiveId(params.get("centroAscoltoId")),
      dataDa: dateValue(params.get("dataDa")),
      dataA: dateValue(params.get("dataA")),
      ricerca: (params.get("ricerca") ?? "").slice(0, 120),
      sortBy: enumValue(
        params.get("sortBy"),
        ["dataDocumento", "dataCreazione", "numero"] as const,
        "dataDocumento",
      ),
      sortDirection: enumValue(
        params.get("sortDirection"),
        ["asc", "desc"] as const,
        "desc",
      ),
    },
    selection,
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}

const managedKeys = [
  "documento",
  "bollaId",
  "trasferimentoId",
  "tipoAggregato",
  "destinatario",
  "stato",
  "areaOperativaId",
  "magazzinoId",
  "centroAscoltoId",
  "dataDa",
  "dataA",
  "ricerca",
  "sortBy",
  "sortDirection",
  "page",
] as const;

export function writeDocumentiOperativiUrl(
  currentSearch: string,
  filters: DocumentoOperativoFilters,
  selection: DocumentoOperativoSelection | null,
  page: number,
): string {
  const params = new URLSearchParams(currentSearch);
  managedKeys.forEach((key) => params.delete(key));

  if (filters.tipoAggregato !== "all")
    params.set("tipoAggregato", filters.tipoAggregato);
  if (filters.destinatario !== "all")
    params.set("destinatario", filters.destinatario);
  if (filters.stato !== "all") params.set("stato", filters.stato);
  if (filters.areaOperativaId !== "all")
    params.set("areaOperativaId", filters.areaOperativaId);
  if (filters.magazzinoId !== "all")
    params.set("magazzinoId", filters.magazzinoId);
  if (filters.centroAscoltoId !== "all")
    params.set("centroAscoltoId", filters.centroAscoltoId);
  if (filters.dataDa) params.set("dataDa", filters.dataDa);
  if (filters.dataA) params.set("dataA", filters.dataA);
  if (filters.ricerca.trim()) params.set("ricerca", filters.ricerca.trim());
  if (filters.sortBy !== "dataDocumento") params.set("sortBy", filters.sortBy);
  if (filters.sortDirection !== "desc")
    params.set("sortDirection", filters.sortDirection);
  if (page > 1) params.set("page", String(page));
  if (selection) params.set("documento", documentoSelectionValue(selection));

  const value = params.toString();
  return value ? `?${value}` : "";
}

export function normalizeDocumentFiltersForAccess(
  filters: DocumentoOperativoFilters,
  access: { canViewBolle: boolean; canViewTransfers: boolean },
): DocumentoOperativoFilters {
  let tipoAggregato = filters.tipoAggregato;
  if (!access.canViewBolle && access.canViewTransfers)
    tipoAggregato = "trasferimento";
  if (access.canViewBolle && !access.canViewTransfers) tipoAggregato = "bolla";

  let destinatario = filters.destinatario;
  if (tipoAggregato === "trasferimento") {
    if (destinatario === "beneficiario" || destinatario === "ente")
      destinatario = "all";
  } else if (tipoAggregato === "bolla" && destinatario === "magazzino") {
    destinatario = "all";
  }

  const validStates =
    tipoAggregato === "bolla"
      ? new Set(["all", "bozza", "confermato", "consegnato", "annullato"])
      : tipoAggregato === "trasferimento"
        ? new Set([
            "all",
            "richiesto",
            "preparato",
            "in_transito",
            "completato",
            "annullato",
          ])
        : new Set([
            "all",
            "bozza",
            "confermato",
            "consegnato",
            "richiesto",
            "preparato",
            "in_transito",
            "completato",
            "annullato",
          ]);

  const dataA =
    filters.dataDa && filters.dataA && filters.dataDa > filters.dataA
      ? ""
      : filters.dataA;

  return {
    ...filters,
    tipoAggregato,
    destinatario,
    centroAscoltoId:
      tipoAggregato === "trasferimento" ? "all" : filters.centroAscoltoId,
    stato: !validStates.has(filters.stato) ? "all" : filters.stato,
    dataA,
  };
}

const documentScopeFilterKeys = [
  "tipoAggregato",
  "destinatario",
  "areaOperativaId",
  "magazzinoId",
  "centroAscoltoId",
] as const satisfies readonly (keyof DocumentoOperativoFilters)[];

export function documentListScopeChanged(
  current: DocumentoOperativoFilters,
  next: DocumentoOperativoFilters,
): boolean {
  return documentScopeFilterKeys.some((key) => current[key] !== next[key]);
}

export function documentiOperativiQuery(
  filters: DocumentoOperativoFilters,
  options?: { page?: number; limit?: number; lockedCentroId?: number | null },
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (filters.tipoAggregato !== "all")
    query.tipoAggregato = filters.tipoAggregato;
  if (filters.destinatario !== "all") query.destinatario = filters.destinatario;
  if (filters.stato !== "all") query.stato = filters.stato;
  if (filters.areaOperativaId !== "all")
    query.areaOperativaId = Number(filters.areaOperativaId);
  if (filters.magazzinoId !== "all")
    query.magazzinoId = Number(filters.magazzinoId);
  const centroId =
    options?.lockedCentroId ??
    (filters.centroAscoltoId !== "all"
      ? Number(filters.centroAscoltoId)
      : null);
  if (centroId != null) query.centroAscoltoId = centroId;
  if (filters.dataDa) query.dataDa = filters.dataDa;
  if (filters.dataA) query.dataA = filters.dataA;
  if (filters.ricerca.trim()) query.ricerca = filters.ricerca.trim();
  query.sortBy = filters.sortBy;
  query.sortDirection = filters.sortDirection;
  if (options?.page != null) query.page = options.page;
  if (options?.limit != null) query.limit = options.limit;
  return query;
}
