import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Intervento,
  InterventiRiepilogoViste,
} from "@workspace/api-client-react";
import { dateTimeEuropeRomeToIso, todayEuropeRome } from "@/lib/europe-rome";
import {
  clearInterventiSocialiFilters,
  defaultInterventiSocialiFilters,
  type InterventiSocialiFilters,
} from "@/lib/interventi-sociali-filters";
import { InterventiSocialiWorkspace } from "./interventi-sociali-workspace";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "it-IT" },
  }),
}));

const today = todayEuropeRome();
const sample: Intervento = {
  id: 1,
  beneficiarioId: 10,
  beneficiarioNome: "Rossi Mario",
  beneficiarioCodice: "BEN-10",
  nucleoFamiliareSintesi: "4 componenti · 2 minori",
  ambito: "sociale",
  ambitoLegacy: false,
  stato: "pianificato",
  priorita: "alta",
  tipoIntervento: "colloquio",
  dataIntervento: null,
  dataOraPianificata: dateTimeEuropeRomeToIso(today, "10:00"),
  dataOraAvvio: null,
  dataOraConclusione: null,
  avviso: "imminente",
  interventoPrecedenteId: 9,
  successoriIds: [2],
  numeroSuccessori: 1,
  sede: "Sede Roma",
  centroAscoltoId: 1,
  centroAscoltoNome: "Centro Roma",
  cittaId: 1,
  operatoreId: 4,
  operatoreNome: "Operatore Test",
  operatoreCodice: "OP-4",
  descrizione: "Colloquio di orientamento",
  dataCreazione: "2026-08-14T08:00:00.000Z",
  dataAggiornamento: "2026-08-14T08:00:00.000Z",
  motivoAnnullamento: null,
  bisogniPianificatiTotale: 0,
  bisogniPianificatiAperti: 0,
  bisogniPianificatiScaduti: 0,
  bisogniPianificatiProssimaScadenza: null,
};

const counts: InterventiRiepilogoViste = {
  daPianificare: 4,
  pianificati: 12,
  oggi: 3,
  inCorso: 1,
  conclusi: 85,
  annullati: 6,
  dataRiferimento: today,
  fusoOrario: "Europe/Rome",
};

function ControlledWorkspace({
  onOpen,
}: {
  onOpen: (row: Intervento) => void;
}) {
  const [filters, setFilters] = useState<InterventiSocialiFilters>(() =>
    defaultInterventiSocialiFilters(),
  );
  return (
    <InterventiSocialiWorkspace
      filters={filters}
      interventi={[sample]}
      counts={counts}
      citta={[{ id: 1, nome: "Roma" }]}
      centri={[{ id: 1, nome: "Centro Roma", cittaId: 1 }]}
      tipi={[{ id: 1, nome: "colloquio", attivo: true }]}
      operatori={[{ id: 4, nome: "Operatore Test", codice: "OP-4" }]}
      isGlobal={false}
      isCentroLocked={false}
      onFiltersChange={setFilters}
      onReset={() => setFilters(clearInterventiSocialiFilters(filters))}
      onOpenIntervento={onOpen}
    />
  );
}

describe("InterventiSocialiWorkspace", () => {
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
    vi.clearAllMocks();
  });

  it("renderizza le sei viste, Oggi predefinita e i contatori", async () => {
    await act(async () =>
      root.render(<ControlledWorkspace onOpen={vi.fn()} />),
    );
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(6);
    expect(
      tabs.find((tab) => tab.getAttribute("aria-selected") === "true")
        ?.textContent,
    ).toContain("interventi.views.oggi");
    expect(document.body.textContent).toContain("85");
    expect(document.body.textContent).toContain("12");
  });

  it("seleziona una vista, combina e azzera i filtri senza loop", async () => {
    await act(async () =>
      root.render(<ControlledWorkspace onOpen={vi.fn()} />),
    );
    const concluded = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) =>
      button.textContent?.includes("interventi.views.conclusi"),
    );
    await act(async () => concluded?.click());
    expect(concluded?.getAttribute("aria-selected")).toBe("true");

    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="interventi.filters.search"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "Rossi BEN-10");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(search?.value).toBe("Rossi BEN-10");
    const reset = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      button.textContent?.includes("interventi.filters.reset"),
    );
    await act(async () => reset?.click());
    expect(search?.value).toBe("");
    expect(concluded?.getAttribute("aria-selected")).toBe("true");
  });

  it("mostra lista desktop e schede mobile e apre il dettaglio da tastiera", async () => {
    const onOpen = vi.fn();
    await act(async () => root.render(<ControlledWorkspace onOpen={onOpen} />));
    expect(
      document.querySelector('[data-testid="interventi-desktop-list"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="interventi-mobile-list"]'),
    ).not.toBeNull();
    const mobileList = document.querySelector(
      '[data-testid="interventi-mobile-list"]',
    );
    expect(mobileList?.textContent).toContain("BEN-10");
    expect(mobileList?.textContent).toContain("Centro Roma");
    expect(mobileList?.textContent).toContain("interventi.list.previous");
    expect(mobileList?.textContent).toContain("interventi.list.following");
    const row = document.querySelector<HTMLTableRowElement>(
      'tbody tr[tabindex="0"]',
    );
    await act(async () =>
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(onOpen).toHaveBeenCalledWith(sample);
  });

  it("passa al calendario, naviga tra i mesi, seleziona il giorno e apre un evento", async () => {
    const onOpen = vi.fn();
    await act(async () => root.render(<ControlledWorkspace onOpen={onOpen} />));
    const calendarButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("interventi.calendarMode"));
    await act(async () => calendarButton?.click());
    expect(
      document.querySelector('[data-testid="interventi-calendar"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="calendar-mobile-agenda"]'),
    ).not.toBeNull();

    const selectedDay = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${today}"]`,
    );
    await act(async () => selectedDay?.click());
    expect(selectedDay?.getAttribute("aria-pressed")).toBe("true");
    const eventButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Rossi Mario"));
    expect(eventButton?.textContent).toContain(
      "interventi.workflowStati.pianificato",
    );
    expect(eventButton?.textContent).toContain("interventi.priorita.alta");
    await act(async () => eventButton?.click());
    expect(onOpen).toHaveBeenCalledWith(sample);

    const next = document.querySelector<HTMLButtonElement>(
      'button[aria-label="interventi.calendar.nextMonth"]',
    );
    await act(async () => next?.click());
    expect(document.querySelector(`button[aria-label="${today}"]`)).toBeNull();

    const calendar = document.querySelector(
      '[data-testid="interventi-calendar"]',
    );
    const goToday = Array.from(
      calendar?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "interventi.views.oggi");
    await act(async () => goToday?.click());
    expect(
      document.querySelector(`button[aria-label="${today}"]`),
    ).not.toBeNull();
  });
});
