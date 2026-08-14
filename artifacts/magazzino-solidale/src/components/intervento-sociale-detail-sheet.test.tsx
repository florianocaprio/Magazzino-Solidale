import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Intervento } from "@workspace/api-client-react";
import { InterventoSocialeDetailSheet } from "./intervento-sociale-detail-sheet";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const intervento = {
  id: 20,
  beneficiarioId: 10,
  beneficiarioNome: "Rossi Mario",
  beneficiarioCodice: "BEN-10",
  nucleoFamiliareSintesi: "3 componenti",
  stato: "concluso",
  ambito: null,
  ambitoLegacy: true,
  priorita: "normale",
  tipoIntervento: "colloquio",
  dataIntervento: "2026-08-14",
  dataOraPianificata: null,
  dataOraAvvio: null,
  dataOraConclusione: null,
  interventoPrecedenteId: 18,
  successoriIds: [21],
  numeroSuccessori: 1,
  sede: "Sede Roma",
  centroAscoltoId: 1,
  centroAscoltoNome: "Centro Roma",
  cittaId: 1,
  operatoreId: 4,
  operatoreNome: "Operatore Test",
  operatoreCodice: "OP-4",
  descrizione: "Descrizione sintetica",
  esito: "Concluso positivamente",
  note: "Nota operativa",
  dataCreazione: "2026-08-14T08:00:00Z",
  dataAggiornamento: "2026-08-14T09:00:00Z",
  motivoAnnullamento: null,
  bisogniPianificatiTotale: 1,
  bisogniPianificatiAperti: 1,
  bisogniPianificatiScaduti: 0,
  bisogniPianificatiProssimaScadenza: "2026-08-20",
} as Intervento;

describe("InterventoSocialeDetailSheet", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("mostra dettaglio, ambito legacy, storico e Bisogni Pianificati senza azioni 5-3C", async () => {
    await act(async () => {
      root.render(
        <InterventoSocialeDetailSheet
          open
          intervento={intervento}
          storico={[
            {
              id: 1,
              interventoId: 20,
              statoPrecedente: null,
              statoNuovo: "concluso",
              operatoreId: 4,
              dataTransizione: "2026-08-14T09:00:00Z",
              motivo: "Creazione pregressa",
            },
          ]}
          bisogni={[
            {
              id: 2,
              interventoId: 20,
              tipo: "azione",
              descrizione: "Contattare il servizio",
              stato: "pianificato",
              dataPrevista: "2026-08-20",
              priorita: "alta",
              note: null,
              dataCompletamento: null,
              dataCreazione: "2026-08-14T09:00:00Z",
              dataAggiornamento: "2026-08-14T09:00:00Z",
            },
          ]}
          onOpenChange={vi.fn()}
        />,
      );
    });
    expect(document.body.textContent).toContain("Rossi Mario");
    expect(document.body.textContent).toContain("interventi.legacy.label");
    expect(document.body.textContent).toContain("Creazione pregressa");
    expect(document.body.textContent).toContain("Contattare il servizio");
    expect(document.body.textContent).not.toContain("Avvia intervento");
    expect(document.body.textContent).not.toContain("Concludi intervento");
  });
});
