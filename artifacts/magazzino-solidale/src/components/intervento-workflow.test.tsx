import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InterventoStatoBadge,
  interventoDataLabel,
  withInterventoAmbito,
} from "./intervento-workflow";

describe("compatibilità workflow interventi", () => {
  it("imposta esplicitamente l'ambito Sociale e UDS sui payload esistenti", () => {
    const base = { beneficiarioId: 10, tipoIntervento: "ascolto" };
    expect(withInterventoAmbito(base, "sociale")).toEqual({
      ...base,
      ambito: "sociale",
    });
    expect(withInterventoAmbito(base, "uds")).toEqual({
      ...base,
      ambito: "uds",
    });
  });

  it("gestisce date legacy, pianificate e completamente assenti", () => {
    expect(
      interventoDataLabel({
        dataIntervento: "2026-08-14",
        dataOraPianificata: null,
      }),
    ).toBe("14/08/2026");
    expect(
      interventoDataLabel({
        dataIntervento: null,
        dataOraPianificata: "2026-08-14T22:30:00.000Z",
      }),
    ).toContain("15/08/2026");
    expect(
      interventoDataLabel({ dataIntervento: null, dataOraPianificata: null }),
    ).toBe("-");
  });

  it("visualizza lo stato senza errori", () => {
    expect(
      renderToStaticMarkup(<InterventoStatoBadge stato="concluso" />),
    ).toContain("concluso");
  });
});
