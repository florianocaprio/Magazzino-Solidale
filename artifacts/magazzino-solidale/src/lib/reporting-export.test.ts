import { describe, expect, it } from "vitest";
import { buildReportingWorkbook } from "./export";

describe("export reportistica", () => {
  it("genera un workbook FSE+ completo anche con dataset vuoto", () => {
    const workbook = buildReportingWorkbook(
      {
        section: "fse-plus",
        filters: { da: "2026-01-01", a: "2026-12-31", anno: 2026, cittaId: null, centroAscoltoId: null, magazzinoId: null, mensaId: null, zonaUdsId: null, operatoreId: null, tipoIntervento: null, tipoServizio: null },
        kpi: [], series: [], tables: [], quality: [], definitions: [],
        generatedAt: "2026-08-15T00:00:00.000Z",
        timezone: "Europe/Rome",
      },
      { title: "FSE+", kpi: (key) => key, table: (key) => key, quality: (key) => key, unavailable: "Dato non disponibile" },
    );
    expect(workbook.SheetNames).toEqual(expect.arrayContaining([
      "00_Riepilogo", "01_Prodotti_FSE", "02_Continuativi", "03_Saltuari_Mensa",
      "04_Saltuari_Pacchi", "05_Saltuari_Strada", "06_Pacchi_Pasti",
      "07_Misure_Accompagnamento", "08_Qualita_Dati", "09_Dettaglio_Controllo",
    ]));
  });
});
