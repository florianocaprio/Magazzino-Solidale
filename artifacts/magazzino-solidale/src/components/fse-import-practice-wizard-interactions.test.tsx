import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { CaricoPraticaDettaglio } from "@workspace/api-client-react";
const api = vi.hoisted(() => ({
  analyze: vi.fn(),
  fetchDetail: vi.fn(),
  resume: vi.fn(),
  reviseDate: vi.fn(),
  reviseRow: vi.fn(),
  attach: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn(),
  close: vi.fn(),
  sources: [{ id: 1, areaOperativaId: 1, descrizione: "Registro unitario" }],
  sessions: [] as Array<{ id: number; stato: string; caricoPraticaId: number }>,
  detail: {
    id: 10,
    sourceRegistryId: 1,
    modalita: "NUOVI_CARICHI",
    files: [] as Array<{
      profilo: string;
      nomeFile: string;
      dataRiferimento?: string;
    }>,
    dataRiferimentoSaldo: null as string | null,
    versione: 2,
    stato: "PRONTA",
    rows: [
      {
        id: 21,
        stato: "PRONTO",
        prodottoEsterno: "Pasta",
        quantitaOperativa: "2",
        errorCodes: [],
      },
    ],
    stockRows: [],
    summary: {
      ready: 1,
      needsMapping: 0,
      needsReview: 0,
      errors: 0,
      known: 0,
      referenceOnly: 0,
    },
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  analyzeFsePracticeImport: api.analyze,
  getFseImportSession: api.fetchDetail,
  useReviseFseReferenceDate: () => ({ isPending: false, mutateAsync: api.reviseDate }),
  getGetFseImportSessionQueryKey: (id: number) => [id],
  getListFseImportSourcesQueryKey: () => ["sources"],
  getListProdottiQueryKey: () => ["/api/prodotti"],
  getListFseImportSessionsQueryKey: () => ["sessions"],
  useListFseImportSources: () => ({ data: api.sources }),
  useListFseImportSessions: () => ({ data: api.sessions }),
  useGetFseImportSession: (id: number) => ({
    data: id ? api.detail : undefined,
    refetch: vi.fn(),
  }),
  useAddFseImportToPractice: () => ({
    mutateAsync: api.attach,
    isPending: false,
  }),
  resolveAutomaticFseImportSource: vi.fn().mockResolvedValue({ id: 1 }),
  useMapFseImportProduct: () => ({ isPending: false }),
  useCreateProdotto: () => ({ isPending: false }),
  useReviseFseImportRow: () => ({ isPending: false, mutateAsync: api.reviseRow }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: api.invalidate }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ hasPermission: () => true, user: { isAdmin: true } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/barcode-scanner-button", () => ({
  BarcodeScannerButton: () => null,
}));
import i18n from "@/lib/i18n";
import { FseImportPracticeWizard } from "./fse-import-practice-wizard";
const initialDetail = structuredClone(api.detail);
let root: Root, host: HTMLDivElement;
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(button, text).toBeTruthy();
  expect(button!.disabled).toBe(false);
  await act(async () => {
    button!.click();
  });
}
async function file(id: string, value: File) {
  const input = document.getElementById(id)!;
  Object.defineProperty(input, "files", { value: [value], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(api.detail, structuredClone(initialDetail));
  api.analyze.mockReset();
  api.fetchDetail.mockReset().mockImplementation(async () => api.detail);
  api.detail.modalita = "NUOVI_CARICHI";
  api.detail.files = [];
  api.detail.dataRiferimentoSaldo = null;
  api.sessions = [];
  await i18n.changeLanguage("it");
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <FseImportPracticeWizard
        open
        onOpenChange={api.close}
        practice={
          {
            id: 4,
            areaOperativaId: 1,
            magazzinoId: 2,
            lottoLogicoId: 3,
            versione: 1,
          } as CaricoPraticaDettaglio
        }
        products={[]}
        onPracticeReady={api.ready}
        onResumePractice={api.resume}
      />,
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("conserva Registro acquisito se Giacenze fallisce, ritenta solo Giacenze e mostra il quarto passaggio senza registrare stock", async () => {
  api.analyze
    .mockResolvedValueOnce({ sessionId: 10 })
    .mockRejectedValueOnce(new Error("File Giacenze non leggibile"))
    .mockResolvedValueOnce({ sessionId: 10 });
  api.attach.mockResolvedValueOnce({ practiceId: 4, addedRows: 1 });
  await file("fse-registry-file", new File(["registro"], "Registro.csv"));
  await file("fse-stock-file", new File(["stock"], "Giacenze.xlsx"));
  const analyze = i18n.t("caricoPratiche.fseAnalyze");
  await click(analyze);
  expect(document.body.textContent).toContain("Registro acquisito");
  expect(document.body.textContent).toContain("Giacenze.xlsx");
  await click(analyze);
  expect(api.analyze.mock.calls.map((c) => c[1].profilo)).toEqual([
    "REGISTRO",
    "GIACENZE",
    "GIACENZE",
  ]);
  expect(api.analyze.mock.calls[2][1].sessionId).toBe(10);
  await click(i18n.t("caricoPratiche.fseReviewSummary"));
  await click(i18n.t("caricoPratiche.fseAddToPractice"));
  expect(document.body.textContent).toContain(
    "Righe selezionate aggiunte alla pratica.",
  );
  expect(api.ready).not.toHaveBeenCalled();
  await click("Torna alla pratica");
  expect(api.ready).toHaveBeenCalledExactlyOnceWith(4);
});
it("rifiuta un file oltre 10 MiB e indica il requisito mancante", async () => {
  const oversized = new File(["x"], "Registro.xlsx");
  Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });
  await file("fse-registry-file", oversized);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "massimo 10 MB",
  );
  expect(document.body.textContent).toContain(
    "Seleziona il file Registro FSE+",
  );
  expect(api.analyze).not.toHaveBeenCalled();
});

it("riprende una sessione Saldo con solo Registro senza richiedere di ricaricarlo", async () => {
  api.detail.modalita = "SALDO_INIZIALE";
  api.detail.files = [
    { profilo: "REGISTRO", nomeFile: "Registro conservato.xlsx" },
  ];
  api.detail.dataRiferimentoSaldo = "2026-10-20";
  api.sessions = [{ id: 10, stato: "DA_COMPLETARE", caricoPraticaId: 4 }];
  api.analyze.mockResolvedValueOnce({ sessionId: 10 });
  await act(async () => {
    root.render(
      <FseImportPracticeWizard
        open
        onOpenChange={api.close}
        practice={
          {
            id: 4,
            areaOperativaId: 1,
            magazzinoId: 2,
            lottoLogicoId: 3,
            versione: 1,
          } as CaricoPraticaDettaglio
        }
        products={[]}
        onPracticeReady={api.ready}
        onResumePractice={api.resume}
      />,
    );
  });
  await click("#10 · DA_COMPLETARE");
  expect(document.body.textContent).toContain("Registro conservato.xlsx");
  await file("fse-stock-file", new File(["stock"], "Giacenze ripresa.csv"));
  await act(async () => {
    (document.querySelector('[role="checkbox"]') as HTMLButtonElement).click();
  });
  await click(i18n.t("caricoPratiche.fseAnalyze"));
  expect(api.analyze).toHaveBeenCalledTimes(1);
  expect(api.analyze.mock.calls[0][1]).toMatchObject({
    sessionId: 10,
    profilo: "GIACENZE",
    modalita: "SALDO_INIZIALE",
  });
});

it("se il file esiste in un’altra pratica propone il recupero e non carica Giacenze nella pratica errata", async () => {
  api.analyze.mockResolvedValueOnce({ sessionId: 18, replay: true });
  api.fetchDetail.mockResolvedValueOnce({ ...api.detail, id: 18, caricoPraticaId: 77 });
  await file("fse-registry-file", new File(["registro"], "Registro.csv"));
  await file("fse-stock-file", new File(["stock"], "Giacenze.xlsx"));
  await click(i18n.t("caricoPratiche.fseAnalyze"));
  expect(api.analyze).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("già salvati in un’altra pratica");
  await click("Riprendi pratica #77");
  expect(api.resume).toHaveBeenCalledWith(77, 18);
  expect(api.attach).not.toHaveBeenCalled();
});

it("sospende senza contabilizzare o annullare la sessione", async () => {
  api.analyze.mockResolvedValueOnce({ sessionId: 10 });
  await file("fse-registry-file", new File(["registro"], "Registro.csv"));
  await click(i18n.t("caricoPratiche.fseAnalyze"));
  expect(document.body.textContent).toContain("Importazione #10 salvata nella pratica #4");
  await click("Sospendi importazione");
  expect(api.close).toHaveBeenCalledWith(false);
  expect(api.attach).not.toHaveBeenCalled();
});

it("usa la data del Registro quando la data Giacenze è lasciata vuota", async () => {
  api.analyze.mockResolvedValue({ sessionId: 10 });
  api.fetchDetail.mockResolvedValueOnce({ ...api.detail, files: [{ profilo: "REGISTRO", dataRiferimento: "2026-10-20" }] });
  await file("fse-registry-file", new File(["registro"], "Registro.csv"));
  await file("fse-stock-file", new File(["stock"], "Giacenze.xlsx"));
  await click(i18n.t("caricoPratiche.fseAnalyze"));
  expect(api.analyze.mock.calls[1][1]).toMatchObject({ profilo: "GIACENZE", dataRiferimento: "2026-10-20" });
});

it("conferma in sequenza solo le date senza altri errori e usa la versione restituita", async () => {
  const base = { ...api.detail.rows[0], tipoMovimento: "CARICO", dataDocumento: "2026-10-20", dataOperativaProposta: "2026-10-20", stato: "DA_VERIFICARE", warningCodes: ["DATA_DOCUMENTO_FALLBACK"] };
  Object.assign(api.detail, { rows: [
    { ...base, id: 21 }, { ...base, id: 22 },
    { ...base, id: 23, errorCodes: ["QUANTITA_NON_COMPATIBILE"] },
    { ...base, id: 24, dataOperativaProposta: "2026-10-19" },
  ] });
  api.analyze.mockResolvedValueOnce({ sessionId: 10 });
  api.reviseRow.mockResolvedValueOnce({ versione: 3 }).mockResolvedValueOnce({ versione: 4 });
  await file("fse-registry-file", new File(["registro"], "Registro.csv"));
  await click(i18n.t("caricoPratiche.fseAnalyze"));
  await click("Conferma la data documento per 2 righe");
  expect(api.reviseRow.mock.calls.map(call => [call[0].rigaId, call[0].data.versione])).toEqual([[21, 2], [22, 3]]);
  expect(api.reviseRow.mock.calls.every(call => call[0].data.accettaFallbackData === true)).toBe(true);
  expect(api.attach).not.toHaveBeenCalled();
});
