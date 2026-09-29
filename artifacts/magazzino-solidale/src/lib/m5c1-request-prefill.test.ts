import { describe, expect, it } from "vitest";
import {
  interventionRequestPrefill,
  interventionReturnUrl,
} from "./m5c1-request-prefill";

describe("M5C1 — prefill Richiesta da Intervento", () => {
  it("usa la data civile Europe/Rome e non include dati inventariali", () => {
    expect(
      interventionRequestPrefill({
        beneficiarioId: 12,
        priorita: "urgente",
        dataOraPianificata: "2026-09-29T22:30:00Z",
      }),
    ).toEqual({
      beneficiarioId: 12,
      priorita: "urgente",
      dataDesiderata: "2026-09-30",
      modalitaPreferita: "da_definire",
    });
  });

  it("lascia vuota la data senza pianificazione", () => {
    expect(
      interventionRequestPrefill({
        beneficiarioId: 12,
        priorita: "normale",
        dataOraPianificata: null,
      }).dataDesiderata,
    ).toBe("");
  });

  it("ritorna al medesimo Intervento nella vista coerente", () => {
    const url = interventionReturnUrl({
      id: 42,
      stato: "pianificato",
      areaOperativaId: 3,
      centroAscoltoId: 7,
    });
    expect(url).toBe(
      "/interventi?vista=pianificati&interventoId=42&areaOperativa=3&centro=7",
    );
  });

  it("preserva il contesto dell'Intervento ancora da pianificare", () => {
    expect(
      interventionReturnUrl({
        id: 13,
        stato: "da_pianificare",
        areaOperativaId: null,
        centroAscoltoId: null,
      }),
    ).toBe("/interventi?vista=da_pianificare&interventoId=13");
  });
});
