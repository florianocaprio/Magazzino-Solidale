import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  importRows: vi.fn(),
  preflight: vi.fn(),
  exportRows: vi.fn(),
  updateProfile: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  profileData: null as Record<string, unknown> | null,
}));

vi.mock("@workspace/api-client-react", () => ({
  usePreviewBeneficiariFse: () => ({ mutateAsync: mocks.preview, isPending: false }),
  useImportBeneficiariFse: () => ({ mutateAsync: mocks.importRows, isPending: false }),
  usePreflightBeneficiariFseExport: () => ({ mutateAsync: mocks.preflight, isPending: false }),
  useExportBeneficiariFse: () => ({ mutateAsync: mocks.exportRows, isPending: false }),
  useGetBeneficiarioFse: () => ({ data: mocks.profileData, isLoading: false, isError: false }),
  useUpdateBeneficiarioFse: () => ({ mutateAsync: mocks.updateProfile, isPending: false }),
  getGetBeneficiarioFseQueryKey: (id: number) => ["beneficiario-fse", id],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

import {
  FSE_BENEFICIARI_HEADERS_UI,
  FseBeneficiariActions,
} from "./fse-beneficiari-actions";
import { BeneficiarioFseCard } from "./beneficiario-fse-card";

function button(label: string) {
  return Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
}

function workbookBytes() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...FSE_BENEFICIARI_HEADERS_UI],
    ["Test", "Import", "FSE-UI", "24/08/2026", 1, "Pacchi", "Attivo", 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Table1");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("Beneficiari 2.0 FSE+: UI", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } },
    });
    mocks.profileData = {
      profilo: {
        codiceFascicolo: "FSE-CARD",
        origineFascicolo: "import_fse",
        origineStranieraMinoranze: 1,
        cittadiniPaesiTerzi: 0,
        senzaTettoEsclusioneAbitativa: 0,
        dataRiferimento: "2026-08-24",
        versione: 1,
        ultimoImportAt: "2026-08-24T10:00:00.000Z",
        ultimoExportAt: null,
      },
      snapshot: { numeroComponenti: 2, donne: 1, uomini: 1, eta017: 1, eta1829: 0, eta3064: 1, eta65Plus: 0 },
      disabili: 0,
      componentiDichiarati: 2,
      componentiDettagliati: 2,
      demografia: {
        numeroComponenti: 2, donne: 2, uomini: 0, eta017: 1, eta1829: 0, eta3064: 1, eta65Plus: 0,
        origine: "anagrafica_calcolata", dettaglioCompleto: true, problemi: [],
      },
      confronto: {
        stato: "non_allineato",
        differenze: [
          { dato: "Donne", snapshot: 1, calcolato: 2 },
          { dato: "Uomini", snapshot: 1, calcolato: 0 },
        ],
      },
    };
    mocks.preview.mockResolvedValue({
      centroAscoltoId: 7,
      areaOperativaId: 3,
      areaOperativaDerivata: true,
      warningHeader: [],
      numeroRighe: 2,
      conteggi: { nuovo: 1, errore: 1 },
      righe: [
        { numeroRiga: 2, codiceFascicolo: "FSE-UI", classificazione: "nuovo", errori: [], warning: [] },
        { numeroRiga: 3, codiceFascicolo: "FSE-BAD", classificazione: "errore", errori: ["Dato non valido"], warning: [] },
      ],
    });
    mocks.importRows.mockResolvedValue({
      batchId: 11, stato: "parziale", creati: 1, collegati: 0, aggiornati: 0,
      invariati: 0, conflitti: 0, errori: 1,
      dettagli: [{ numeroRiga: 3, codiceFascicolo: "FSE-BAD", esito: "errore", errori: ["DATO_NON_VALIDO"] }],
    });
    mocks.updateProfile.mockResolvedValue({});
    mocks.preflight.mockResolvedValue({
      centroAscoltoId: 7,
      areaOperativaId: 3,
      dataRiferimento: "2026-08-24",
      candidati: 1,
      esportabili: 1,
      bloccati: [],
      warning: [],
    });
    mocks.exportRows.mockResolvedValue(new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("nasconde le azioni senza permessi", async () => {
    await act(async () => root.render(<FseBeneficiariActions
      centri={[]}
      lockedCentroId={null}
      canImport={false}
      canExport={false}
      onImported={vi.fn()}
    />));
    expect(button("Importa FSE+")).toBeUndefined();
    expect(button("Esporta FSE+")).toBeUndefined();
  });

  it("mostra lo scope derivato e consente un import parziale esplicito", async () => {
    const onImported = vi.fn();
    await act(async () => root.render(<FseBeneficiariActions
      centri={[{ id: 7, nome: "Centro UI", areaOperativaId: 3, areaOperativaNome: "Area UI" }]}
      lockedCentroId={7}
      canImport
      canExport={false}
      onImported={onImported}
    />));
    await act(async () => button("Importa FSE+")?.click());
    expect(document.body.textContent).toContain("Area Operativa: Area UI");
    const dataRiferimento = document.querySelector<HTMLInputElement>(
      'input[aria-label="Data di riferimento import FSE+"]',
    )!.value;
    const input = document.querySelector<HTMLInputElement>('input[aria-label="File FSE+"]')!;
    const bytes = workbookBytes();
    const file = new File([bytes], "beneficiari-test.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    Object.defineProperty(file, "arrayBuffer", { value: vi.fn().mockResolvedValue(bytes) });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.preview).toHaveBeenCalled();
    expect(mocks.preview).toHaveBeenCalledWith({
      data: { centroAscoltoId: 7, dataRiferimento, file },
    });
    expect(document.body.textContent).toContain("Le righe non valide saranno escluse");
    const confirm = button("Conferma importazione") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await act(async () => { confirm.click(); await Promise.resolve(); });
    expect(mocks.importRows).toHaveBeenCalled();
    expect(mocks.importRows).toHaveBeenCalledWith({
      data: { centroAscoltoId: 7, dataRiferimento, file, risoluzioni: "[]" },
    });
    expect(onImported).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Risultato import · batch 11");
  });

  it("visualizza differenze demografiche e limita la modifica al permesso", async () => {
    await act(async () => root.render(<BeneficiarioFseCard beneficiarioId={42} canManage={false} />));
    expect(document.body.textContent).toContain("FSE-CARD");
    expect(document.body.textContent).toContain("Non allineato");
    expect(document.body.textContent).toContain("Differenze: Donne 1→2, Uomini 1→0");
    expect(button("Modifica")).toBeUndefined();

    await act(async () => root.render(<BeneficiarioFseCard beneficiarioId={42} canManage />));
    await act(async () => button("Modifica")?.click());
    const code = document.querySelector<HTMLInputElement>("#fse-code")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(code, "FSE-CARD-EDIT");
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Salva")?.click(); await Promise.resolve(); });
    expect(mocks.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: 42,
      data: expect.objectContaining({ codiceFascicolo: "FSE-CARD-EDIT" }),
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it("distingue i valori FSE non valorizzati dallo zero e salva il profilo senza codice", async () => {
    mocks.profileData = {
      ...(mocks.profileData ?? {}),
      profilo: {
        ...((mocks.profileData?.profilo as Record<string, unknown>) ?? {}),
        codiceFascicolo: null,
        origineStranieraMinoranze: null,
        cittadiniPaesiTerzi: 0,
        senzaTettoEsclusioneAbitativa: null,
      },
    };
    await act(async () => root.render(<BeneficiarioFseCard beneficiarioId={42} canManage />));
    expect(document.body.textContent).toContain("Non ancora assegnato");
    expect(document.body.textContent).toContain("Origine/minoranze: Non valorizzato");
    expect(document.body.textContent).toContain("Paesi terzi: 0");
    expect(document.body.textContent).toContain("Esclusione abitativa: Non valorizzato");

    await act(async () => button("Modifica")?.click());
    const code = document.querySelector<HTMLInputElement>("#fse-code")!;
    const unknown = document.querySelector<HTMLInputElement>("#fse-origineStranieraMinoranze")!;
    const explicitZero = document.querySelector<HTMLInputElement>("#fse-cittadiniPaesiTerzi")!;
    expect(code.value).toBe("");
    expect(unknown.value).toBe("");
    expect(explicitZero.value).toBe("0");
    await act(async () => { button("Salva")?.click(); await Promise.resolve(); });
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      id: 42,
      data: {
        dataRiferimento: "2026-08-24",
        versione: 1,
        origineStranieraMinoranze: null,
        cittadiniPaesiTerzi: 0,
        senzaTettoEsclusioneAbitativa: null,
      },
    });
  });

  it("mantiene null i valori FSE di un beneficiario ancora privo di profilo", async () => {
    mocks.profileData = {
      ...(mocks.profileData ?? {}),
      profilo: null,
      snapshot: null,
    };
    await act(async () => root.render(<BeneficiarioFseCard beneficiarioId={42} canManage />));
    expect(document.body.textContent).toContain("Non ancora assegnato");
    expect(document.body.textContent).toContain("Origine/minoranze: Non valorizzato");
    expect(document.body.textContent).toContain("Paesi terzi: Non valorizzato");
    expect(document.body.textContent).toContain("Esclusione abitativa: Non valorizzato");

    await act(async () => button("Modifica")?.click());
    expect(document.querySelector<HTMLInputElement>("#fse-code")?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#fse-origineStranieraMinoranze")?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#fse-cittadiniPaesiTerzi")?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#fse-senzaTettoEsclusioneAbitativa")?.value).toBe("");

    await act(async () => { button("Salva")?.click(); await Promise.resolve(); });
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      id: 42,
      data: {
        dataRiferimento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        versione: 0,
        origineStranieraMinoranze: null,
        cittadiniPaesiTerzi: null,
        senzaTettoEsclusioneAbitativa: null,
      },
    });
  });

  it("blocca il download al preflight e scarica l'XLSX soltanto quando esportabile", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fse-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mocks.preflight
      .mockResolvedValueOnce({
        centroAscoltoId: 7,
        areaOperativaId: 3,
        dataRiferimento: "2026-08-24",
        candidati: 1,
        esportabili: 0,
        bloccati: [{
          beneficiarioId: 42,
          codice: "BEN-42",
          errori: ["CITTADINI_PAESI_TERZI_NON_VALORIZZATO"],
          warning: [],
        }],
        warning: [],
      })
      .mockResolvedValueOnce({
        centroAscoltoId: 7,
        areaOperativaId: 3,
        dataRiferimento: "2026-08-24",
        candidati: 1,
        esportabili: 1,
        bloccati: [],
        warning: [],
      });

    const onImported = vi.fn();
    await act(async () => root.render(<FseBeneficiariActions
      centri={[{ id: 7, nome: "Centro UI", areaOperativaId: 3, areaOperativaNome: "Area UI" }]}
      lockedCentroId={7}
      canImport={false}
      canExport
      onImported={onImported}
    />));
    await act(async () => button("Esporta FSE+")?.click());
    await act(async () => { button("Esegui preflight")?.click(); await Promise.resolve(); });
    expect(document.body.textContent).toContain("CITTADINI_PAESI_TERZI_NON_VALORIZZATO");
    expect((button("Scarica Excel") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => button("Annulla")?.click());
    await act(async () => button("Esporta FSE+")?.click());
    await act(async () => { button("Esegui preflight")?.click(); await Promise.resolve(); });
    expect((button("Scarica Excel") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { button("Scarica Excel")?.click(); await Promise.resolve(); });
    expect(mocks.exportRows).toHaveBeenCalledWith({
      data: expect.objectContaining({ centroAscoltoId: 7, soloAttivi: true }),
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fse-export");
    expect(onImported).toHaveBeenCalledOnce();
  });

  it("richiede una scelta collega o crea e mantiene bloccante il conflitto", async () => {
    mocks.preview.mockResolvedValueOnce({
      centroAscoltoId: 7,
      areaOperativaId: 3,
      areaOperativaDerivata: true,
      warningHeader: [],
      numeroRighe: 1,
      conteggi: { possibile_duplicato: 1 },
      righe: [{
        numeroRiga: 2,
        codiceFascicolo: "FSE-DUP",
        classificazione: "possibile_duplicato",
        errori: [],
        warning: ["Possibile duplicato"],
        duplicati: [{ id: 9, codice: "BEN-9" }],
      }],
    });
    await act(async () => root.render(<FseBeneficiariActions
      centri={[{ id: 7, nome: "Centro UI", areaOperativaId: 3, areaOperativaNome: "Area UI" }]}
      lockedCentroId={7}
      canImport
      canExport={false}
      onImported={vi.fn()}
    />));
    await act(async () => button("Importa FSE+")?.click());
    const dataRiferimento = document.querySelector<HTMLInputElement>(
      'input[aria-label="Data di riferimento import FSE+"]',
    )!.value;
    const input = document.querySelector<HTMLInputElement>('input[aria-label="File FSE+"]')!;
    const bytes = workbookBytes();
    const file = new File([bytes], "duplicato.xlsx");
    Object.defineProperty(file, "arrayBuffer", { value: vi.fn().mockResolvedValue(bytes) });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
    expect((button("Conferma importazione") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => button("Collega a BEN-9")?.click());
    expect((button("Conferma importazione") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => button("Crea nuovo")?.click());
    await act(async () => { button("Conferma importazione")?.click(); await Promise.resolve(); });
    expect(mocks.importRows).toHaveBeenCalledWith({
      data: {
        centroAscoltoId: 7,
        dataRiferimento,
        file,
        risoluzioni: JSON.stringify([{ numeroRiga: 2, azione: "crea" }]),
      },
    });

    await act(async () => button("Chiudi")?.click());
    mocks.preview.mockResolvedValueOnce({
      centroAscoltoId: 7,
      areaOperativaId: 3,
      areaOperativaDerivata: true,
      warningHeader: [],
      numeroRighe: 1,
      conteggi: { conflitto: 1 },
      righe: [{ numeroRiga: 2, codiceFascicolo: "FSE-CONFLICT", classificazione: "conflitto", errori: ["Codice associato altrove"], warning: [] }],
    });
    await act(async () => button("Importa FSE+")?.click());
    const conflictInput = document.querySelector<HTMLInputElement>('input[aria-label="File FSE+"]')!;
    const conflictFile = new File([bytes], "conflitto.xlsx");
    Object.defineProperty(conflictFile, "arrayBuffer", { value: vi.fn().mockResolvedValue(bytes) });
    Object.defineProperty(conflictInput, "files", { configurable: true, value: [conflictFile] });
    await act(async () => { conflictInput.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
    expect(document.body.textContent).toContain("Codice associato altrove");
    expect((button("Conferma importazione") as HTMLButtonElement).disabled).toBe(true);
  });
});
