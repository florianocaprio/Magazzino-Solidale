import { describe, expect, it } from "vitest";
import {
  canonicalLegacyTrasferimentiSearch,
  parseDocumentoOperativoSelection,
  withDocumentoOperativoSelection,
} from "./documenti-operativi-location";

describe("identità URL dei documenti operativi", () => {
  it("distingue aggregati diversi con lo stesso id", () => {
    expect(parseDocumentoOperativoSelection("?documento=bolla%3A7")).toEqual({
      tipo: "bolla",
      id: 7,
    });
    expect(
      parseDocumentoOperativoSelection("?documento=trasferimento%3A7"),
    ).toEqual({ tipo: "trasferimento", id: 7 });
  });

  it("adatta i due parametri dettaglio legacy", () => {
    expect(parseDocumentoOperativoSelection("?bollaId=11")).toEqual({
      tipo: "bolla",
      id: 11,
    });
    expect(parseDocumentoOperativoSelection("?trasferimentoId=13")).toEqual({
      tipo: "trasferimento",
      id: 13,
    });
  });

  it("preserva filtri e mantiene una sola selezione canonica", () => {
    expect(
      withDocumentoOperativoSelection(
        "?stato=bozza&bollaId=2&trasferimentoId=3",
        { tipo: "trasferimento", id: 9 },
      ),
    ).toBe("?stato=bozza&documento=trasferimento%3A9");
  });

  it("rimuove soltanto l'identità quando chiude il dettaglio", () => {
    expect(
      withDocumentoOperativoSelection(
        "?tipoAggregato=bolla&documento=bolla%3A4",
        null,
      ),
    ).toBe("?tipoAggregato=bolla");
  });

  it("porta la lista legacy Trasferimenti sulla facciata filtrata", () => {
    expect(canonicalLegacyTrasferimentiSearch("?trasferimentoId=5")).toBe(
      "?documento=trasferimento%3A5&tipoAggregato=trasferimento",
    );
    expect(canonicalLegacyTrasferimentiSearch("?stato=in_transito")).toBe(
      "?stato=in_transito&tipoAggregato=trasferimento",
    );
    expect(
      canonicalLegacyTrasferimentiSearch(
        "?trasferimentoId=9&stato=richiesto&page=2",
      ),
    ).toBe(
      "?stato=richiesto&page=2&documento=trasferimento%3A9&tipoAggregato=trasferimento",
    );
  });

  it("ignora id non validi e valori ambigui", () => {
    expect(parseDocumentoOperativoSelection("?documento=bolla:0")).toBeNull();
    expect(parseDocumentoOperativoSelection("?bollaId=1.5")).toBeNull();
  });
});
