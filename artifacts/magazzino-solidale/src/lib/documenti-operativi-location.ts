export type DocumentoOperativoSelection = {
  tipo: "bolla" | "trasferimento";
  id: number;
};

const DOCUMENTO_PATTERN = /^(bolla|trasferimento):([1-9][0-9]*)$/;

function positiveId(value: string | null): number | null {
  if (value == null || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function parseDocumentoOperativoSelection(
  search: string,
): DocumentoOperativoSelection | null {
  const params = new URLSearchParams(search);
  const canonical = params.get("documento")?.match(DOCUMENTO_PATTERN);
  if (canonical) {
    return {
      tipo: canonical[1] as DocumentoOperativoSelection["tipo"],
      id: Number(canonical[2]),
    };
  }

  const legacyBollaId = positiveId(params.get("bollaId"));
  if (legacyBollaId != null) return { tipo: "bolla", id: legacyBollaId };
  const legacyTransferId = positiveId(params.get("trasferimentoId"));
  if (legacyTransferId != null) {
    return { tipo: "trasferimento", id: legacyTransferId };
  }
  return null;
}

export function withDocumentoOperativoSelection(
  search: string,
  selection: DocumentoOperativoSelection | null,
): string {
  const params = new URLSearchParams(search);
  params.delete("documento");
  params.delete("bollaId");
  params.delete("trasferimentoId");
  if (selection) {
    params.set("documento", `${selection.tipo}:${selection.id}`);
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function canonicalLegacyTrasferimentiSearch(search: string): string {
  const params = new URLSearchParams(
    withDocumentoOperativoSelection(
      search,
      parseDocumentoOperativoSelection(search),
    ),
  );
  if (!params.has("tipoAggregato")) {
    params.set("tipoAggregato", "trasferimento");
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}
