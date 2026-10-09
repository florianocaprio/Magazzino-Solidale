import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { BeneficiarioAccessoEmporioSearchResult } from "@workspace/api-client-react";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
import { EmporioBeneficiaryResults } from "./emporio-beneficiary-results";
let root: Root, host: HTMLDivElement;
const select = vi.fn();
const luca: BeneficiarioAccessoEmporioSearchResult = {
  beneficiarioId: 13,
  beneficiarioNome: "Romano Luca",
  beneficiarioCodice: "SYNTHETIC-LUCA",
  centroAscoltoNome: "Il Dono",
  creditoSolidaleAbilitato: true,
  creditoSolidaleStato: "attivo",
  saldoCreditoSolidale: null,
  attivo: true,
  emporioStato: "attivo",
  pianificabile: true,
  motiviNonPianificabile: [],
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  select.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});
async function mount(
  overrides: Partial<Parameters<typeof EmporioBeneficiaryResults>[0]> = {},
) {
  await act(() =>
    root.render(
      <EmporioBeneficiaryResults
        results={[luca]}
        selectedId=""
        requested
        searching={false}
        error={false}
        onSelect={select}
        canConfigureCredit={false}
        {...overrides}
      />,
    ),
  );
}
it("F3: Luca is immediately visible and one explicit click selects the exact ID", async () => {
  await mount();
  expect(host.textContent).toContain("Romano Luca");
  await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(select).toHaveBeenCalledExactlyOnceWith(13);
});
it("F3: selected beneficiary is visibly pressed without automatic name selection", async () => {
  await mount({ selectedId: "13" });
  expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(select).not.toHaveBeenCalled();
});
it.each([
  "credito_non_abilitato",
  "credito_non_attivo",
  "emporio_non_abilitato",
  "emporio_sospeso",
  "emporio_programmato",
  "centro_non_valido",
])("F3: %s remains visible, explained and disabled", async (reason) => {
  await mount({
    results: [
      { ...luca, pianificabile: false, motiviNonPianificabile: [reason] },
    ],
  });
  expect(host.textContent).toContain(`accessiEmporio.motivi.${reason}`);
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(host.querySelector("a")).toBeNull();
  expect(select).not.toHaveBeenCalled();
});
it("F3: credit configuration links only when the caller is authorized, never enables credit itself", async () => {
  await mount({
    canConfigureCredit: true,
    results: [
      {
        ...luca,
        pianificabile: false,
        motiviNonPianificabile: ["credito_non_abilitato"],
      },
    ],
  });
  expect(host.querySelector("a")!.getAttribute("href")).toBe("/beneficiari/13");
  expect(select).not.toHaveBeenCalled();
});
it.each([{ searching: true }, { error: true }, { requested: false }])(
  "F3: pending/error/no-query never exposes stale result buttons %j",
  async (state) => {
    await mount(state);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  },
);
it("F3: empty scoped result explicitly says not found", async () => {
  await mount({ results: [] });
  expect(host.textContent).toContain("accessiEmporio.nessunBeneficiario");
});
