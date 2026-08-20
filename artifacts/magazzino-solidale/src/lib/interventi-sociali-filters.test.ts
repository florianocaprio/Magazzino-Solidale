import { describe, expect, it } from "vitest";
import {
  clearInterventiSocialiFilters,
  parseInterventiSocialiFilters,
  serializeInterventiSocialiFilters,
} from "./interventi-sociali-filters";

const reference = new Date("2026-08-14T10:00:00Z");

describe("filtri URL degli interventi Sociali", () => {
  it("usa Oggi come vista predefinita e normalizza valori malformati", () => {
    const filters = parseInterventiSocialiFilters(
      "?vista=sconosciuta&areaOperativa=-2&da=2026-02-31&modo=calendario",
      reference,
    );
    expect(filters.vista).toBe("oggi");
    expect(filters.areaOperativaId).toBe("");
    expect(filters.da).toBe("");
    expect(filters.modo).toBe("calendario");
  });

  it("conserva vista e filtri in un round-trip equivalente al refresh", () => {
    const first = parseInterventiSocialiFilters(
      "?vista=annullati&q=rossi&priorita=urgente&centro=12&stato=mancata_presentazione&legacy=legacy&ordina=beneficiario&direzione=desc",
      reference,
    );
    expect(
      parseInterventiSocialiFilters(
        serializeInterventiSocialiFilters(first),
        reference,
      ),
    ).toEqual(first);
  });

  it("azzera i filtri senza cambiare la vista selezionata", () => {
    const filters = parseInterventiSocialiFilters(
      "?vista=conclusi&q=persona&priorita=alta",
      reference,
    );
    expect(clearInterventiSocialiFilters(filters)).toMatchObject({
      vista: "conclusi",
      ricerca: "",
      priorita: "",
    });
  });
});
