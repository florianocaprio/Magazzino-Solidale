import {
  parseDocumentoSelection,
  documentoSelectionValue,
  type DocumentoOperativoSelection,
} from "./documenti-operativi-url";

/** Accept only canonical local document links returned by the authorized request. */
export function linkedDocumentSelection(
  path?: string | null,
): DocumentoOperativoSelection | null {
  if (!path || !/^\/(bolle|trasferimenti)\?/.test(path)) return null;
  const url = new URL(path, "http://local.invalid");
  const canonical = parseDocumentoSelection(url.searchParams.get("documento"));
  if (canonical) return canonical;
  const type = url.pathname === "/bolle" ? "bolla" : "trasferimento";
  return parseDocumentoSelection(
    `${type}:${url.searchParams.get(type === "bolla" ? "bollaId" : "trasferimentoId")}`,
  );
}

export function requestAllowsDocument(
  selected: DocumentoOperativoSelection,
  documents: { percorsoDocumento?: string | null }[],
): boolean {
  return documents.some((document) => {
    const linked = linkedDocumentSelection(document.percorsoDocumento);
    return (
      linked != null &&
      documentoSelectionValue(linked) === documentoSelectionValue(selected)
    );
  });
}
