import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  state: "non_abilitato",
  error: undefined as unknown,
  grant: true,
  mutate: vi.fn().mockResolvedValue({}),
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetEmporioAbilitazioneQueryKey: (id: number) => [
    `/api/emporio/beneficiari/${id}/abilitazione`,
  ],
  useGetEmporioAbilitazione: () => ({
    data: { stato: mocks.state },
    error: mocks.error,
  }),
  useUpdateEmporioAbilitazione: () => ({
    mutateAsync: mocks.mutate,
    isPending: false,
  }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, isAdmin: false, centroAscoltoId: 2 },
    hasArea: (a: string) => a === "sociale",
    hasPermission: () => mocks.grant,
  }),
}));
vi.mock("@/lib/use-moduli", () => ({
  useModuloFlags: () => ({ emporioAbilitato: true }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { BeneficiarioEmporioSection } from "./beneficiario-emporio-card";
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.state = "non_abilitato";
  mocks.error = undefined;
  mocks.grant = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  client.clear();
  vi.clearAllMocks();
});
async function mount() {
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <BeneficiarioEmporioSection
          beneficiario={{
            id: 7,
            attivo: true,
            areaOperativaId: 1,
            centroAscoltoId: 2,
          }}
        />
      </QueryClientProvider>,
    ),
  );
}
it("T08: absent right displays NON ABILITATO and requires an explicit motive", async () => {
  await mount();
  expect(host.textContent).toContain("emporioServizio.non_abilitato");
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(host.querySelectorAll("button")).toHaveLength(1);
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it.each(["attivo", "sospeso", "revocato"])(
  "T09: lifecycle %s exposes only pertinent commands",
  async (state) => {
    mocks.state = state;
    await mount();
    expect(host.textContent).toContain(`emporioServizio.${state}`);
    expect(host.textContent?.includes("emporioServizio.sospendi")).toBe(
      state === "attivo",
    );
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "emporioServizio.revoca",
      ),
    ).toBe(state !== "revocato");
  },
);
it("T20: cashier cannot grant eligibility", async () => {
  mocks.grant = false;
  await mount();
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.textContent).toContain("emporioServizio.non_abilitato");
});
it("canonical denial hides cached eligibility", async () => {
  mocks.state = "attivo";
  mocks.error = { status: 403 };
  await mount();
  expect(host.textContent).not.toContain("emporioServizio.attivo");
  expect(host.querySelectorAll("button")).toHaveLength(0);
});
