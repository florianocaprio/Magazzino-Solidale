import React, { act, createContext, useContext, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: {
    id: 1,
    isAdmin: true,
    areaOperativaId: null as number | null,
    centroAscoltoId: null,
    aree: ["mensa"],
    permessi: ["mensa.view"],
  },
  error: false,
  rows: [
    {
      id: 10,
      areaOperativaId: 1,
      areaOperativaNome: "Roma",
      nome: "Mensa Roma",
      attiva: true,
    },
    {
      id: 20,
      areaOperativaId: 2,
      areaOperativaNome: "Milano",
      nome: "Mensa Milano",
      attiva: true,
    },
  ],
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@workspace/api-client-react", () => ({
  getListMenseQueryKey: () => ["mense"],
  useListMense: () => ({
    data: state.rows,
    isError: state.error,
    isLoading: false,
    refetch: vi.fn(),
    error: new Error("Scope revocato"),
  }),
}));
const Choice = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, disabled }: any) => (
    <fieldset disabled={disabled}>
      <Choice.Provider value={onValueChange}>{children}</Choice.Provider>
    </fieldset>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectItem: ({ children, value }: any) => {
    const choose = useContext(Choice);
    return (
      <button data-area={value} onClick={() => choose(value)}>
        {children}
      </button>
    );
  },
}));
import {
  MensaOperationalContext,
  useMensaContext,
} from "./mensa-operational-context";

function Consumer() {
  const context = useMensaContext()!;
  const [draft, setDraft] = useState(false);
  return (
    <section data-testid="content">
      <span>{context.mense.map((m) => m.nome).join(",")}</span>
      <output>{String(draft)}</output>
      <button
        data-draft
        onClick={() => {
          setDraft(true);
          context.setDirty(true);
        }}
      >
        Bozza
      </button>
    </section>
  );
}
let host: HTMLDivElement, root: Root;
const render = () =>
  act(() =>
    root.render(
      <MensaOperationalContext>
        <Consumer />
      </MensaOperationalContext>,
    ),
  );
const click = (selector: string) =>
  act(() => host.querySelector<HTMLButtonElement>(selector)!.click());
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.error = false;
  state.user = {
    id: 1,
    isAdmin: true,
    areaOperativaId: null,
    centroAscoltoId: null,
    aree: ["mensa"],
    permessi: ["mensa.view"],
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("AO-01: admin multi-area sceglie esplicitamente; il cambio protegge e poi elimina il draft", () => {
  expect(host.querySelector("section")).toBeNull();
  click('[data-area="1"]');
  expect(host.querySelector("section")?.textContent).toContain("Mensa Roma");
  click("[data-draft]");
  click('[data-area="2"]');
  expect(host.querySelector("section")?.textContent).toContain("Mensa Roma");
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  const confirm = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "common.discardChanges",
  )!;
  act(() => confirm.click());
  expect(host.querySelector("section")?.textContent).toContain("Mensa Milano");
  expect(host.querySelector("output")?.textContent).toBe("false");
});
it("AO-02: area fissa non espandibile, utente ordinario senza scope non operativo", () => {
  state.user = { ...state.user, isAdmin: false, areaOperativaId: 1 };
  render();
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
  expect(host.querySelector("section")?.textContent).not.toContain("Milano");
  state.user = { ...state.user, areaOperativaId: null };
  render();
  expect(host.querySelector("section")).toBeNull();
  expect(host.textContent).toContain("mensa.noAssignment");
});
it("SEC-01: query revocata nasconde dati cached; nuovo attore non eredita draft", () => {
  click('[data-area="1"]');
  click("[data-draft]");
  state.error = true;
  render();
  expect(host.querySelector("section")).toBeNull();
  state.error = false;
  state.user = { ...state.user, id: 2, areaOperativaId: 2 };
  render();
  expect(host.querySelector("section")?.textContent).toContain("Mensa Milano");
  expect(host.querySelector("output")?.textContent).toBe("false");
});
