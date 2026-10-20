import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  recover: vi.fn(),
  close: vi.fn(),
  complete: vi.fn(),
  refetch: vi.fn(),
  grant: true,
  error: false,
  preview: {
    beneficiarioId: 7,
    versioneBeneficiario: 3,
    areaNome: "Roma",
    politicaNome: "Politica",
    totaleSuggerito: 60,
    quotaMensileAssegnata: 60,
    motivoModificaQuota: null,
    primaQuotaAmmessa: true,
    calcoloToken: "a".repeat(64),
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  attivaEmporioCredito: mocks.post,
  getEmporioCreditoAttivazioneEsito: mocks.recover,
  getGetEmporioCreditoAnteprimaQueryKey: (id: number) => [
    `/api/emporio/beneficiari/${id}/attivazione-credito`,
  ],
  useGetEmporioCreditoAnteprima: () => ({
    data: mocks.preview,
    isLoading: false,
    isFetching: false,
    isError: mocks.error,
    refetch: mocks.refetch,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, isAdmin: false },
    hasArea: () => true,
    hasPermission: () => mocks.grant,
  }),
}));
vi.mock("@/hooks/use-emporio-security", () => ({
  useEmporioSecurity: () => ({
    readOptions: (key: unknown) => ({ queryKey: key }),
  }),
  emporioReadableData: (q: { data: unknown }) => q.data,
}));
import { EmporioCreditoActivationDialog } from "./emporio-credito-activation-dialog";
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.grant = true;
  mocks.error = false;
  mocks.post.mockReset();
  mocks.recover.mockReset();
  mocks.preview.quotaMensileAssegnata = 60;
  mocks.preview.primaQuotaAmmessa = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  client.clear();
});
async function mount() {
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <EmporioCreditoActivationDialog
          beneficiarioId={7}
          motivo="Valutazione sociale"
          onClose={mocks.close}
          onComplete={mocks.complete}
        />
      </QueryClientProvider>,
    ),
  );
}
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (x) => x.textContent === name,
  )!;
async function fill(selector: string, value: string, textarea = false) {
  const input = document.querySelector(selector)!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      textarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("non accredita all'apertura; 80 è totale e richiede motivo", async () => {
  await mount();
  expect(mocks.post).not.toHaveBeenCalled();
  await fill('input[type="number"]', "80");
  await act(() => button("ciclo2Credito.confirm").click());
  expect(mocks.post).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull();
  await fill("textarea", "Deroga motivata", true);
  mocks.post.mockResolvedValue({
    beneficiarioId: 7,
    quotaMensile: 80,
    quotaAccreditata: 80,
  });
  await act(() => button("ciclo2Credito.confirm").click());
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.post.mock.calls[0][1]).toMatchObject({
    quotaMensileAssegnata: 80,
    motivoModificaQuota: "Deroga motivata",
    versioneBeneficiario: 3,
    calcoloToken: mocks.preview.calcoloToken,
  });
  expect(mocks.complete).toHaveBeenCalledTimes(1);
});
it("risposta persa blocca altra intenzione e recupera la medesima ricevuta", async () => {
  mocks.post.mockRejectedValue(new TypeError("Connessione interrotta"));
  await mount();
  await act(() => button("ciclo2Credito.confirm").click());
  expect(button("ciclo2Credito.confirm")).toBeUndefined();
  const key = mocks.post.mock.calls[0][1].idempotencyKey;
  expect(sessionStorage.getItem("emporio-attivazione:1:7")).toBe(key);
  expect(sessionStorage.length).toBe(1);
  mocks.recover.mockResolvedValue({ beneficiarioId: 7, quotaAccreditata: 60 });
  await act(() => button("ciclo2Credito.recover").click());
  expect(mocks.recover).toHaveBeenCalledWith(7, { idempotencyKey: key });
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.complete).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(0);
});
it("riapertura con intenzione pendente propone recupero, mai un nuovo POST", async () => {
  sessionStorage.setItem("emporio-attivazione:1:7", "opaque-key");
  await mount();
  expect(button("ciclo2Credito.confirm")).toBeUndefined();
  mocks.recover.mockRejectedValue({ status: 404 });
  await act(() => button("ciclo2Credito.recover").click());
  expect(mocks.refetch).toHaveBeenCalled();
  expect(button("ciclo2Credito.confirm")).toBeDefined();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("revoca grant nasconde dati cached e impedisce comando", async () => {
  await mount();
  mocks.grant = false;
  await mount();
  expect(document.body.textContent).not.toContain("Roma");
  expect(button("ciclo2Credito.confirm").disabled).toBe(true);
  expect(mocks.post).not.toHaveBeenCalled();
});
it("409 richiede nuova anteprima senza completare il percorso", async () => {
  mocks.post.mockRejectedValue({
    status: 409,
    data: { error: "Nucleo modificato" },
  });
  await mount();
  await act(() => button("ciclo2Credito.confirm").click());
  expect(mocks.refetch).toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Nucleo modificato");
});
it("doppio click mentre il comando è in corso invia una sola intenzione", async () => {
  let finish!: (v: unknown) => void;
  mocks.post.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await mount();
  await act(() => {
    button("ciclo2Credito.confirm").click();
    button("ciclo2Credito.confirm").click();
  });
  expect(mocks.post).toHaveBeenCalledTimes(1);
  await act(() => finish({ beneficiarioId: 7, quotaAccreditata: 60 }));
  expect(mocks.complete).toHaveBeenCalledTimes(1);
});

it("diniego canonico del comando nasconde immediatamente l'anteprima cached",async()=>{
  mocks.post.mockRejectedValue({status:403,data:{error:"Revoca autorizzazione"}});await mount();await act(()=>button("ciclo2Credito.confirm").click());expect(document.body.textContent).not.toContain("Roma");expect(button("ciclo2Credito.confirm").disabled).toBe(true);expect(mocks.complete).not.toHaveBeenCalled();
});
