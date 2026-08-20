import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildReportingWorkbook } from "./export";

const labels = {
  title: "FSE+", kpi: (key: string) => key, table: (key: string) => key,
  quality: (key: string) => key, column: (key: string) => key,
  unit: (key: string) => key, availability: (key: string) => key,
  text: (value: string) => value,
  unavailable: "Dato non disponibile", locale: "it",
  metadata: {
    from: "Da", to: "A", areaOperativa: "Area Operativa", centre: "Centro", warehouse: "Magazzino",
    mensa: "Mensa", zone: "Zona", allAreeOperative: "Tutte", allCentres: "Tutti",
    allWarehouses: "Tutti", allMense: "Tutte", allZones: "Tutte",
    generatedAt: "Generato il", application: "Applicazione", indicator: "Indicatore",
    value: "Valore", unit: "Unità", availability: "Disponibilità", definitions: "Definizioni",
    notes: "Note", rows: "righe", reportGeneratedBy: "Report generato da",
  },
};

describe("export reportistica", () => {
  it("genera un workbook FSE+ completo anche con dataset vuoto", () => {
    const localizedLabels = {
      ...labels,
      column: (key: string) => ({ stato: "Status", nota: "Note" })[key] ?? key,
      text: (value: string) =>
        value === "Il modello operativo non rende disponibile questo dettaglio senza inferenze."
          ? "The operational model does not provide this detail without inference."
          : value,
    };
    const workbook = buildReportingWorkbook(
      {
        section: "fse-plus",
        filters: { da: "2026-01-01", a: "2026-12-31", anno: 2026, areaOperativaId: null, centroAscoltoId: null, magazzinoId: null, mensaId: null, zonaUdsId: null, operatoreId: null, tipoIntervento: null, tipoServizio: null },
        kpi: [], series: [], tables: [], quality: [], definitions: [],
        generatedAt: "2026-08-15T00:00:00.000Z",
        timezone: "Europe/Rome",
      },
      localizedLabels,
    );
    expect(workbook.SheetNames).toEqual(expect.arrayContaining([
      "00_Riepilogo", "01_Prodotti_FSE", "02_Continuativi", "03_Saltuari_Mensa",
      "04_Saltuari_Pacchi", "05_Saltuari_Strada", "06_Pacchi_Pasti",
      "07_Misure_Accompagnamento", "08_Qualita_Dati", "09_Dettaglio_Controllo",
    ]));
    const fallbackRows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets["02_Continuativi"],
      { header: 1 },
    );
    expect(fallbackRows).toContainEqual(["Status", "Dato non disponibile"]);
    expect(fallbackRows).toContainEqual([
      "Note",
      "The operational model does not provide this detail without inference.",
    ]);
  });

  it("popola il dettaglio FSE+ con dati auditabili e senza nominativi", () => {
    const workbook = buildReportingWorkbook(
      {
        section: "fse-plus",
        filters: { da: "2026-01-01", a: "2026-12-31", anno: 2026, areaOperativaId: 1, centroAscoltoId: null, magazzinoId: null, mensaId: null, zonaUdsId: null, operatoreId: null, tipoIntervento: null, tipoServizio: null },
        kpi: [], series: [], tables: [], quality: [], definitions: [],
        generatedAt: "2026-08-15T00:00:00.000Z", timezone: "Europe/Rome",
      },
      labels,
      { areaOperativa: "Roma" },
      {
        section: "fse-plus", metric: "prodottiFse", page: 1, pageSize: 1, total: 1,
        columns: ["data", "documento", "beneficiarioCodice", "prodotto", "lotto", "quantita", "unita", "canale"],
        rows: [{ data: "2026-06-01", documento: "B-1", beneficiarioCodice: "BEN-1", prodotto: "Pasta", lotto: "L-1", quantita: 2, unita: "kg", canale: "pacchi" }],
      },
    );
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["09_Dettaglio_Controllo"]);
    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatchObject({ documento: "B-1", beneficiarioCodice: "BEN-1", canale: "pacchi" });
    expect(detail[0]).not.toHaveProperty("nome");
    expect(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["00_Riepilogo"], { header: 1 })).toContainEqual(["Area Operativa", "Roma"]);
  });
});
