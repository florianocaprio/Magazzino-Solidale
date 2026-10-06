import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENTO_FILTERS,
  filtersAfterDocumentCreation,
  normalizeDocumentFiltersForAccess,
  readDocumentiOperativiUrl,
  writeDocumentiOperativiUrl,
} from "./documenti-operativi-url";
import {
  linkedDocumentSelection,
  requestAllowsDocument,
} from "./richiesta-documento-navigation";

describe("M5C2-A-R2 — stati, inserimento e contesto", () => {
  it.each([
    ["bolla", "bozza"],
    ["bolla", "confermato"],
    ["bolla", "in_trasporto"],
    ["bolla", "rientro_atteso"],
    ["bolla", "rientrato"],
    ["bolla", "consegnato"],
    ["bolla", "annullato"],
    ["trasferimento", "richiesto"],
    ["trasferimento", "preparato"],
    ["trasferimento", "in_transito"],
    ["trasferimento", "rientro_atteso"],
    ["trasferimento", "rientrato"],
    ["trasferimento", "completato"],
    ["trasferimento", "annullato"],
  ] as const)(
    "conserva %s/%s dopo serializzazione e normalizzazione",
    (tipoAggregato, stato) => {
      const filters = { ...DEFAULT_DOCUMENTO_FILTERS, tipoAggregato, stato };
      const parsed = readDocumentiOperativiUrl(
        writeDocumentiOperativiUrl("", filters, null, 3),
      );
      expect(
        normalizeDocumentFiltersForAccess(parsed.filters, {
          canViewBolle: true,
          canViewTransfers: true,
        }),
      ).toEqual(filters);
      expect(parsed.page).toBe(3);
    },
  );
  it("default per inserimento ma preserva un ordinamento esplicito", () => {
    expect(readDocumentiOperativiUrl("").filters.sortBy).toBe("dataCreazione");
    const explicit = readDocumentiOperativiUrl(
      "?sortBy=dataDocumento&sortDirection=asc",
    );
    expect(
      readDocumentiOperativiUrl(
        writeDocumentiOperativiUrl("", explicit.filters, null, 1),
      ).filters,
    ).toEqual(explicit.filters);
  });
  it("nuova Bolla restringe lo scope effettivo e rimuove filtri incompatibili", () => {
    const aligned = filtersAfterDocumentCreation(
      {
        ...DEFAULT_DOCUMENTO_FILTERS,
        stato: "annullato",
        ricerca: "altro",
        dataA: "2000-01-01",
        areaOperativaId: "4",
        centroAscoltoId: "8",
      },
      {
        magazzinoId: 7,
        areaOperativaId: 4,
        centroAscoltoId: 8,
        tipoDestinatario: "beneficiario",
      },
    );
    expect(aligned).toMatchObject({
      areaOperativaId: "4",
      centroAscoltoId: "8",
      magazzinoId: "7",
      stato: "all",
      ricerca: "",
      dataA: "",
      sortBy: "dataCreazione",
    });
  });
  it("rifiuta riferimenti esterni, ambigui o appartenenti a un'altra richiesta", () => {
    expect(linkedDocumentSelection("https://other/bolle?bollaId=3")).toBeNull();
    expect(linkedDocumentSelection("/bolle?bollaId=0")).toBeNull();
    const docs = [{ percorsoDocumento: "/bolle?documento=bolla%3A3" }];
    expect(requestAllowsDocument({ tipo: "bolla", id: 3 }, docs)).toBe(true);
    expect(requestAllowsDocument({ tipo: "bolla", id: 4 }, docs)).toBe(false);
    expect(requestAllowsDocument({ tipo: "trasferimento", id: 3 }, docs)).toBe(
      false,
    );
  });
});
