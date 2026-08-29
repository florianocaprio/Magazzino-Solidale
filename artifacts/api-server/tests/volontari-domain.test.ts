import { describe, expect, it } from "vitest";
import {
  addCalendarMonthsClamped,
  evaluateOperationalState,
  extendedCoverageEnd,
  inclusiveCoverageEnd,
  normalizeCodiceFiscale,
  normalizeRoleName,
  subtractCalendarMonths,
} from "../src/lib/volontariDomain";

const approved = {
  approvazione: "approvato",
  amministrativamenteAttivo: true,
  tipoVolontario: "PERMANENTE",
  riferimento: "2027-03-15",
  giornataValida: false,
};

describe("Volontari 2.0 — regole di dominio", () => {
  it("calcola la scadenza inclusiva di una nuova copertura", () => {
    expect(inclusiveCoverageEnd("2027-02-01", 12)).toBe("2028-01-31");
    expect(inclusiveCoverageEnd("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("estende dalla scadenza corrente rispettando fine mese e anno bisestile", () => {
    expect(extendedCoverageEnd("2027-01-31", 12)).toBe("2028-01-31");
    expect(extendedCoverageEnd("2024-02-29", 12)).toBe("2025-02-28");
    expect(addCalendarMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("usa mesi di calendario per il filtro delle scadenze recenti", () => {
    expect(subtractCalendarMonths("2024-03-31", 1)).toBe("2024-02-29");
    expect(subtractCalendarMonths("2027-03-31", 1)).toBe("2027-02-28");
  });

  it("rende operativo un permanente approvato, abilitato e assicurato", () => {
    expect(
      evaluateOperationalState({
        ...approved,
        coperture: [
          {
            dataInizio: "2027-01-01",
            dataFine: "2027-12-31",
            annullata: false,
          },
        ],
      }),
    ).toMatchObject({
      operativo: true,
      motivoNonOperativo: null,
      statoAssicurazione: "VALIDA",
    });
  });

  it("rende non operativo senza job quando l'assicurazione è scaduta", () => {
    expect(
      evaluateOperationalState({
        ...approved,
        coperture: [
          {
            dataInizio: "2026-01-01",
            dataFine: "2027-03-14",
            annullata: false,
          },
        ],
      }),
    ).toMatchObject({
      operativo: false,
      motivoNonOperativo: "ASSICURAZIONE_SCADUTA",
      statoAssicurazione: "SCADUTA",
    });
  });

  it("non rende operativo un temporaneo fuori dalla giornata registrata", () => {
    expect(
      evaluateOperationalState({
        ...approved,
        tipoVolontario: "TEMPORANEO",
        coperture: [],
      }),
    ).toMatchObject({
      operativo: false,
      motivoNonOperativo: "GIORNATA_TEMPORANEA_MANCANTE",
      statoAssicurazione: "TEMPORANEA",
    });
    expect(
      evaluateOperationalState({
        ...approved,
        tipoVolontario: "TEMPORANEO",
        giornataValida: true,
        coperture: [],
      }),
    ).toMatchObject({
      operativo: true,
      giornataTemporaneaValida: true,
      statoAssicurazione: "TEMPORANEA",
    });
  });

  it("mantiene approvazione e sospensione prioritarie per un temporaneo", () => {
    expect(
      evaluateOperationalState({
        ...approved,
        tipoVolontario: "TEMPORANEO",
        approvazione: "in_attesa",
        giornataValida: true,
        coperture: [],
      }),
    ).toMatchObject({
      operativo: false,
      motivoNonOperativo: "IN_ATTESA_APPROVAZIONE",
      statoAssicurazione: "TEMPORANEA",
    });
    expect(
      evaluateOperationalState({
        ...approved,
        tipoVolontario: "TEMPORANEO",
        amministrativamenteAttivo: false,
        giornataValida: true,
        coperture: [],
      }),
    ).toMatchObject({
      operativo: false,
      motivoNonOperativo: "SOSPENSIONE_MANUALE",
      statoAssicurazione: "TEMPORANEA",
    });
  });

  it("la riattivazione non supera approvazione o assicurazione scaduta", () => {
    expect(
      evaluateOperationalState({
        ...approved,
        approvazione: "in_attesa",
        coperture: [],
      }),
    ).toMatchObject({
      operativo: false,
      motivoNonOperativo: "IN_ATTESA_APPROVAZIONE",
    });
    expect(
      evaluateOperationalState({ ...approved, coperture: [] }),
    ).toMatchObject({
      operativo: false,
      motivoNonOperativo: "ASSICURAZIONE_MANCANTE",
    });
  });

  it("una copertura non annulla una sospensione manuale", () => {
    expect(
      evaluateOperationalState({
        ...approved,
        amministrativamenteAttivo: false,
        coperture: [
          {
            dataInizio: "2027-01-01",
            dataFine: "2027-12-31",
            annullata: false,
          },
        ],
      }),
    ).toMatchObject({
      operativo: false,
      motivoNonOperativo: "SOSPENSIONE_MANUALE",
      sospesoManualmente: true,
    });
  });

  it("normalizza chiavi anagrafiche e ruoli senza duplicati di case o spazi", () => {
    expect(normalizeCodiceFiscale(" rss mra 80a01 h501u ")).toBe(
      "RSSMRA80A01H501U",
    );
    expect(normalizeRoleName("  Autista / Consegne  ")).toBe(
      "autista consegne",
    );
    expect(normalizeRoleName("AUTISTA—CONSEGNE")).toBe("autista consegne");
  });
});
