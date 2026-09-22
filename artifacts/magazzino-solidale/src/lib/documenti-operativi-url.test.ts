import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENTO_FILTERS,
  documentListScopeChanged,
  documentiOperativiQuery,
  normalizeDocumentFiltersForAccess,
  parseDocumentoSelection,
  readDocumentiOperativiUrl,
  writeDocumentiOperativiUrl,
} from "./documenti-operativi-url";

describe("M4A — URL e filtri Documenti operativi", () => {
  it("usa una selezione canonica tipo:id ed esclude valori ambigui", () => {
    expect(parseDocumentoSelection("bolla:12")).toEqual({
      tipo: "bolla",
      id: 12,
    });
    expect(parseDocumentoSelection("trasferimento:12")).toEqual({
      tipo: "trasferimento",
      id: 12,
    });
    expect(parseDocumentoSelection("12")).toBeNull();
    expect(parseDocumentoSelection("bolla:0")).toBeNull();
  });

  it("migra i deep link legacy e riscrive una sola selezione preservando i filtri", () => {
    const parsed = readDocumentiOperativiUrl(
      "?bollaId=7&trasferimentoId=9&stato=confermato&foo=keep",
    );
    expect(parsed.selection).toEqual({ tipo: "bolla", id: 7 });
    const rewritten = writeDocumentiOperativiUrl(
      "?bollaId=7&trasferimentoId=9&foo=keep",
      parsed.filters,
      parsed.selection,
      1,
    );
    expect(rewritten).toContain("foo=keep");
    expect(rewritten).toContain("documento=bolla%3A7");
    expect(rewritten).not.toContain("bollaId");
    expect(rewritten).not.toContain("trasferimentoId");
  });

  it("serializza filtri, pagina e selezione senza perdere parametri estranei", () => {
    const filters = {
      ...DEFAULT_DOCUMENTO_FILTERS,
      tipoAggregato: "trasferimento" as const,
      destinatario: "magazzino" as const,
      stato: "in_transito",
      areaOperativaId: "2",
      magazzinoId: "5",
      dataDa: "2026-09-01",
      dataA: "2026-09-19",
      ricerca: "  TR-42  ",
      sortBy: "numero" as const,
      sortDirection: "asc" as const,
    };
    const search = writeDocumentiOperativiUrl(
      "?preserve=yes",
      filters,
      { tipo: "trasferimento", id: 42 },
      3,
    );
    const parsed = readDocumentiOperativiUrl(search);
    expect(parsed.filters).toMatchObject({
      ...filters,
      ricerca: "TR-42",
    });
    expect(parsed.selection).toEqual({ tipo: "trasferimento", id: 42 });
    expect(parsed.page).toBe(3);
    expect(search).toContain("preserve=yes");
  });

  it("forza il solo dominio autorizzato e non riusa stati incompatibili", () => {
    expect(
      normalizeDocumentFiltersForAccess(
        {
          ...DEFAULT_DOCUMENTO_FILTERS,
          tipoAggregato: "bolla",
          destinatario: "ente",
          stato: "consegnato",
          centroAscoltoId: "4",
        },
        { canViewBolle: false, canViewTransfers: true },
      ),
    ).toMatchObject({
      tipoAggregato: "trasferimento",
      destinatario: "all",
      stato: "all",
      centroAscoltoId: "all",
    });
  });

  it("espone solo gli stati reali M4A e scarta etichette di prenotazione", () => {
    const access = { canViewBolle: true, canViewTransfers: true };
    expect(
      normalizeDocumentFiltersForAccess(
        { ...DEFAULT_DOCUMENTO_FILTERS, stato: "prenotato" },
        access,
      ).stato,
    ).toBe("all");
    expect(
      normalizeDocumentFiltersForAccess(
        {
          ...DEFAULT_DOCUMENTO_FILTERS,
          tipoAggregato: "trasferimento",
          stato: "preparato",
        },
        access,
      ).stato,
    ).toBe("preparato");
  });

  it("costruisce lo stesso insieme filtrato per lista ed export, senza paginazione nell'export", () => {
    const filters = {
      ...DEFAULT_DOCUMENTO_FILTERS,
      ricerca: "PAM",
      areaOperativaId: "3",
      sortDirection: "asc" as const,
    };
    const list = documentiOperativiQuery(filters, {
      page: 2,
      limit: 50,
      lockedCentroId: 8,
    });
    const exported = documentiOperativiQuery(filters, { lockedCentroId: 8 });
    expect(list).toMatchObject({
      ricerca: "PAM",
      areaOperativaId: 3,
      centroAscoltoId: 8,
      page: 2,
      limit: 50,
    });
    expect(exported).toEqual({
      areaOperativaId: 3,
      centroAscoltoId: 8,
      ricerca: "PAM",
      sortBy: "dataDocumento",
      sortDirection: "asc",
    });
  });

  it("distingue i cambi di scope dai soli criteri di ordinamento", () => {
    expect(
      documentListScopeChanged(DEFAULT_DOCUMENTO_FILTERS, {
        ...DEFAULT_DOCUMENTO_FILTERS,
        areaOperativaId: "2",
      }),
    ).toBe(true);
    expect(
      documentListScopeChanged(DEFAULT_DOCUMENTO_FILTERS, {
        ...DEFAULT_DOCUMENTO_FILTERS,
        sortDirection: "asc",
      }),
    ).toBe(false);
  });
});
