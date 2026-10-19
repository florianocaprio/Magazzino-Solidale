import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { registerUtentiActions } from "@/lib/i18n/namespaces/utentiActions";

const mocks = vi.hoisted(() => ({
  users: [
    {
      id: 2,
      username: "long-user-name-for-tablet",
      nome: "Synthetic",
      cognome: "User",
      email: "very-long-email@example.org",
      emailDaAggiornare: false,
      ruoloId: null,
      attivo: true,
      isSuperAdmin: false,
    },
  ],
  temporary: vi.fn(),
  email: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
  pending: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  useListUtenti: () => ({ data: mocks.users, isLoading: false }),
  useListRuoli: () => ({ data: [] }),
  useListCentriAscolto: () => ({ data: [] }),
  useListAreeOperative: () => ({ data: [] }),
  useListZoneUds: () => ({ data: [] }),
  getListUtentiQueryKey: () => ["utenti"],
  useCreateUtente: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUtente: () => ({ mutate: mocks.update, isPending: false }),
  useDeleteUtente: () => ({ mutate: mocks.remove, isPending: false }),
  useResetUtentePassword: () => ({ mutate: mocks.email, isPending: false }),
  useSetUtenteTemporaryPassword: () => ({
    mutate: mocks.temporary,
    isPending: mocks.pending,
  }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, isAdmin: true, isSuperAdmin: false, aree: [] },
    refresh: mocks.refresh,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { username?: string }) =>
      params?.username ? `${key} ${params.username}` : key,
  }),
}));
vi.mock("@/lib/i18n", () => ({
  default: { t: (key: string) => key, addResourceBundle: vi.fn() },
}));
import Utenti from "./utenti";

let container: HTMLDivElement, root: Root;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label,
  )!;
async function openActions() {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  )!;
  trigger.focus();
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  return trigger;
}
async function select(label: string) {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((i) => i.textContent === label)!;
  expect(item).toBeTruthy();
  await act(async () => item.click());
}
async function input(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.pending = false;
  mocks.users[0].attivo = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Utenti />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BUG 01 — azioni Utenti", () => {
  it("carica le nuove traduzioni con la pagina e conserva quelle esistenti al cambio lingua", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "it",
      resources: { it: { translation: { utenti: { title: "Utenti" } } } },
    });
    registerUtentiActions(instance);
    expect(instance.t("utenti.title")).toBe("Utenti");
    expect(instance.t("utenti.temporaryAction")).toBe(
      "Assegna password temporanea",
    );
    await instance.changeLanguage("en");
    expect(instance.t("utenti.temporaryAction")).toBe(
      "Assign temporary password",
    );
    await instance.changeLanguage("ar");
    expect(instance.t("utenti.actions")).toBe("الإجراءات");
  });
  it("espone il controllo etichettato nella prima cella e permette l'apertura da tastiera", async () => {
    const first = document.querySelector("tbody tr td")!;
    expect(first.querySelector("button")?.getAttribute("aria-label")).toContain(
      mocks.users[0].username,
    );
    await openActions();
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map(
        (i) => i.textContent,
      ),
    ).toEqual(
      expect.arrayContaining([
        "common.edit",
        "utenti.temporaryAction",
        "utenti.resetPassword",
        "utenti.remove",
      ]),
    );
  });
  it("in modifica consente il ruolo e non richiede assegnazioni Mensa", async () => {
    await openActions();
    await select("common.edit");
    const role = document.querySelector<HTMLButtonElement>('[role="combobox"]');
    expect(role).toBeTruthy();
    expect(role!.disabled).toBe(false);
    expect(button("utenti.saveChanges")).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "mensa.operatorAssignments",
    );
    expect(document.body.textContent).not.toContain("mensa.assignmentHint");
  });
  it("convalida e invia la password temporanea attraverso l'azione distinta dall'email", async () => {
    await openActions();
    await select("utenti.temporaryAction");
    await input("u-temporary", "SyntheticTemp42");
    await input("u-temporary-confirm", "different43");
    const form = document.getElementById("u-temporary")!.closest("form")!;
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(mocks.temporary).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "utenti.passwordMismatch",
    );
    await input("u-temporary-confirm", "SyntheticTemp42");
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(mocks.temporary).toHaveBeenCalledWith(
      { id: 2, data: { newPassword: "SyntheticTemp42" } },
      expect.any(Object),
    );
    expect(mocks.email).not.toHaveBeenCalled();
    await act(async () => mocks.temporary.mock.calls[0][1].onSuccess());
    expect(document.getElementById("u-temporary")).toBeNull();
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("mantiene il recupero email senza inviare una password", async () => {
    await openActions();
    await select("utenti.resetPassword");
    await act(async () => button("utenti.resetButton").click());
    expect(mocks.email).toHaveBeenCalledWith({ id: 2 }, expect.any(Object));
    expect(mocks.temporary).not.toHaveBeenCalled();
  });
  it("Elimina invia la modalità conservativa approvata D01", async () => {
    await openActions();
    await select("utenti.remove");
    await act(async () => button("utenti.remove").click());
    expect(mocks.remove).toHaveBeenCalledWith(
      { id: 2, params: { removeIfUnused: true } },
      expect.any(Object),
    );
  });
  it("disabilita le azioni durante il reset per prevenire invii ripetuti", async () => {
    mocks.pending = true;
    await act(async () => root.render(<Utenti />));
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
        .disabled,
    ).toBe(true);
  });
});
