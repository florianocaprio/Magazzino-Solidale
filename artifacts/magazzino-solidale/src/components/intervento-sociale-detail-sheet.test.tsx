import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Intervento,
  InterventoOperativita,
} from "@workspace/api-client-react";
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
  risultato: "Risultato finale",
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

const operativita: InterventoOperativita = {
  interventoId: 20,
  stato: "concluso",
  versione: "2026-08-14T09:00:00Z",
  risultato: "Risultato finale",
  esito: "Concluso positivamente",
  note: "Nota operativa",
  attivita: [],
  materiali: [],
  documenti: [],
};

const callbacks = {
  onPianifica: vi.fn(),
  onAvvia: vi.fn(),
  onSalva: vi.fn(),
  onConcludi: vi.fn(),
  onAnnulla: vi.fn(),
  onMancataPresentazione: vi.fn(),
};

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

  it("mostra dettaglio terminale, storico e dati operativi in sola lettura", async () => {
    await act(async () => {
      root.render(
        <InterventoSocialeDetailSheet
          open
          intervento={intervento}
          operativita={operativita}
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
          {...callbacks}
        />,
      );
    });
    expect(document.body.textContent).toContain("Rossi Mario");
    expect(document.body.textContent).toContain("interventi.legacy.label");
    expect(document.body.textContent).toContain("Creazione pregressa");
    expect(document.body.textContent).toContain("Contattare il servizio");
    expect(document.body.textContent).not.toContain(
      "interventi.operational.start",
    );
    expect(document.body.textContent).not.toContain(
      "interventi.operational.conclude",
    );
  });

  it("inizializza il workspace una volta per apertura e conserva il form dopo un errore", async () => {
    const onOpenChange = vi.fn();
    const running = {
      ...intervento,
      stato: "in_corso",
      ambito: "sociale",
      ambitoLegacy: false,
      dataOraAvvio: "2026-08-14T08:30:00Z",
    } as Intervento;
    const runningOperational = {
      ...operativita,
      stato: "in_corso",
      risultato: null,
      esito: null,
      attivita: [
        {
          id: 1,
          interventoId: 20,
          tipologiaId: null,
          tipologiaSnapshot: "Colloquio",
          descrizione: "Descrizione iniziale",
          risultato: null,
          operatoreId: 4,
          dataCreazione: "2026-08-14T08:30:00Z",
          dataAggiornamento: "2026-08-14T08:30:00Z",
        },
      ],
    } satisfies InterventoOperativita;

    const render = (open: boolean) => (
      <InterventoSocialeDetailSheet
        open={open}
        intervento={running}
        operativita={runningOperational}
        onOpenChange={onOpenChange}
        {...callbacks}
      />
    );
    await act(async () => root.render(render(false)));
    await act(async () => root.render(render(true)));
    expect(onOpenChange).not.toHaveBeenCalled();
    const description = Array.from(
      document.body.querySelectorAll("textarea"),
    ).find(
      (element) =>
        (element as HTMLTextAreaElement).value === "Descrizione iniziale",
    ) as HTMLTextAreaElement;
    expect(description).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(description, "Modifica non salvata");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.render(render(true)));
    expect(description.value).toBe("Modifica non salvata");

    await act(async () => root.render(render(false)));
    await act(async () => root.render(render(true)));
    const reopenedDescription = Array.from(
      document.body.querySelectorAll("textarea"),
    ).find(
      (element) =>
        (element as HTMLTextAreaElement).value === "Descrizione iniziale",
    );
    expect(reopenedDescription).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
