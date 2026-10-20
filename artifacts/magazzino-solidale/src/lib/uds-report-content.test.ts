import { describe, expect, it } from "vitest";
import type { UdsInterventoGiornaliero } from "@workspace/api-client-react";
import { udsReportSections } from "./uds-report-content";

const row: UdsInterventoGiornaliero = {
  id: 42,
  beneficiarioId: 7,
  dataIntervento: "2026-08-14",
  tipoIntervento: "ascolto",
  stato: "concluso",
  numeroIntervento: 4,
  primoIntervento: false,
  descrizione: "Ascolto e orientamento",
  note: "Due coperte",
  noteUds: "Rivedersi venerdì",
  bisogniPianificati: [
    {
      id: 1,
      tipo: "azione",
      descrizione: "Accompagnamento",
      stato: "pianificato",
      priorita: "alta",
      dataPrevista: "2026-09-10",
      note: "Confermare l'orario",
    },
  ],
};

describe("contenuto operativo condiviso UI/PDF UDS", () => {
  it("mantiene distinti sintesi, materiale e nota, con piano futuro e stato corrente", () => {
    const sections = udsReportSections(row, (k) => k);
    expect(sections.map((s) => s.text).slice(0, 3)).toEqual([
      "Ascolto e orientamento",
      "Due coperte",
      "Rivedersi venerdì",
    ]);
    expect(sections[3].text).toContain("2026-09-10");
    expect(sections[3].text).toContain("pianificato");
    expect(sections[3].text).toContain("Confermare l'orario");
  });
  it("non interpreta il materiale mancante come nessuna consegna", () => {
    const sections = udsReportSections(
      { ...row, note: null, bisogniPianificati: [] },
      (k) => k,
    );
    expect(sections[1].text).toBe("udsReportGiornaliero.notRecorded");
    expect(sections[3].text).toBe("udsInterventi.noBisogniPianificati");
  });
  it("conserva più bisogni e il completamento senza deduzioni dal testo", () => {
    const sections = udsReportSections(
      {
        ...row,
        bisogniPianificati: [
          ...row.bisogniPianificati,
          {
            id: 2,
            tipo: "richiesta",
            descrizione: "Vestiti",
            stato: "completato",
            priorita: "normale",
            dataCompletamento: "2026-08-15T10:00:00Z",
          },
        ],
      },
      (k) => k,
    );
    expect(sections[3].text).toContain("Accompagnamento");
    expect(sections[3].text).toContain("Vestiti");
    expect(sections[3].text).toContain("completedDate");
  });
});
