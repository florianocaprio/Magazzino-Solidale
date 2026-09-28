/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { logicalDocumentProgress } from "../src/lib/m5bProgress";

describe("M5B — avanzamento logistico derivato", () => {
  it.each([
    ["bolla", "bozza", "in_preparazione"],
    ["bolla", "confermato", "pronta"],
    ["bolla", "in_trasporto", "in_viaggio"],
    ["bolla", "rientro_atteso", "rientro_atteso"],
    ["bolla", "consegnato", "esito_registrato"],
    ["bolla", "rientrato", "rientrato"],
    ["bolla", "annullato", "annullato"],
    ["trasferimento", "richiesto", "in_preparazione"],
    ["trasferimento", "preparato", "pronta"],
    ["trasferimento", "in_transito", "in_viaggio"],
    ["trasferimento", "rientro_atteso", "rientro_atteso"],
    ["trasferimento", "completato", "esito_registrato"],
    ["trasferimento", "rientrato", "rientrato"],
    ["trasferimento", "annullato", "annullato"],
  ] as const)("%s %s → %s", (tipo, stato, expected) => {
    expect(logicalDocumentProgress(tipo, stato)).toBe(expected);
  });

  it("non confonde stati sconosciuti o di altro aggregato con Da preparare", () => {
    expect(logicalDocumentProgress("bolla", "completato")).toBe(
      "stato_non_riconosciuto",
    );
    expect(logicalDocumentProgress("trasferimento", "consegnato")).toBe(
      "stato_non_riconosciuto",
    );
    expect(logicalDocumentProgress("bolla", "futuro")).toBe(
      "stato_non_riconosciuto",
    );
    expect(logicalDocumentProgress("bolla", null)).toBe("non_disponibile");
  });
});
