import { describe, expect, it } from "vitest";
import {
  civilDateEuropeRome,
  dateTimeEuropeRomeToIso,
  formatDateEuropeRome,
  monthRange,
  shiftMonth,
} from "./europe-rome";

describe("date civili Europe/Rome", () => {
  it("cambia giorno secondo Roma vicino alla mezzanotte", () => {
    expect(civilDateEuropeRome("2026-08-14T21:59:59Z")).toBe("2026-08-14");
    expect(civilDateEuropeRome("2026-08-14T22:00:00Z")).toBe("2026-08-15");
  });

  it("usa il confine CET invernale indipendentemente dal timezone del processo", () => {
    expect(civilDateEuropeRome("2026-01-14T22:59:59.999Z")).toBe("2026-01-14");
    expect(civilDateEuropeRome("2026-01-14T23:00:00.000Z")).toBe("2026-01-15");
  });

  it("formatta date civili senza interpretarle come timestamp UTC", () => {
    expect(formatDateEuropeRome("2026-08-22")).toBe("22/08/2026");
  });

  it("formatta i timestamp usando esplicitamente Europe/Rome", () => {
    expect(formatDateEuropeRome("2026-08-22T22:30:00Z")).toBe("23/08/2026");
  });

  it("rifiuta l'ora inesistente al passaggio all'ora legale", () => {
    expect(() => dateTimeEuropeRomeToIso("2026-03-29", "02:30")).toThrow(
      "non esistono",
    );
  });

  it("sceglie in modo deterministico la prima ora duplicata al rientro solare", () => {
    expect(dateTimeEuropeRomeToIso("2026-10-25", "02:30")).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("calcola intervalli e navigazione mensili come date civili", () => {
    expect(monthRange("2028-02")).toEqual({
      da: "2028-02-01",
      a: "2028-02-29",
    });
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
