import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  password: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  specialPermissions: [] as string[],
}));
vi.mock("@workspace/api-client-react", () => ({
  useUpdateMyProfile: () => ({ mutate: mocks.email, isPending: false }),
  useChangePassword: () => ({ mutate: mocks.password, isPending: false }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: {
      id: 5,
      nome: "Utente",
      username: "uds",
      email: "old@example.org",
      emailDaAggiornare: false,
      permessiSpeciali: mocks.specialPermissions,
    },
    refresh: mocks.refresh,
    logout: vi.fn(),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
import Profilo from "./profilo";

let container: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.specialPermissions = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Profilo />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function fill(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(index: number) {
  await act(async () => {
    container
      .querySelectorAll("form")
      [
        index
      ].dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("evidenzia UTENTE SPECIALE solo quando il server segnala permessi aggiuntivi", async () => {
  expect(container.textContent).not.toContain("profile.specialUser");
  mocks.specialPermissions = ["credito.view"];
  await act(async () => root.render(<Profilo />));
  expect(container.textContent).toContain("profile.specialUser");
  expect(container.textContent).toContain("profile.specialUserDescription");
  mocks.specialPermissions = [];
  await act(async () => root.render(<Profilo />));
  expect(container.textContent).not.toContain("profile.specialUser");
});
it("salva soltanto l'email normalizzata e aggiorna l'identità dopo il successo", async () => {
  await fill("profile-email", "New@Example.org");
  await submit(0);
  expect(mocks.email.mock.calls[0][0]).toEqual({
    data: { email: "new@example.org" },
  });
  await act(async () => {
    await mocks.email.mock.calls[0][1].onSuccess();
  });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenCalledWith({ title: "profile.emailSaved" });
});
it("mostra l'errore email senza annunciare un salvataggio", async () => {
  await fill("profile-email", "duplicate@example.org");
  await submit(0);
  await act(async () => {
    mocks.email.mock.calls[0][1].onError({
      data: { error: "Email già utilizzata" },
    });
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Email già utilizzata",
  );
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("i due occhi mostrano solo il rispettivo campo e non inviano il form", async () => {
  await fill("new", "Esempio-1234");
  await fill("confirm", "Esempio-1234");
  const buttons = container.querySelectorAll<HTMLButtonElement>(
    "button[aria-controls]",
  );
  await act(async () => buttons[0].click());
  expect(container.querySelector<HTMLInputElement>("#new")!.type).toBe("text");
  expect(container.querySelector<HTMLInputElement>("#confirm")!.type).toBe(
    "password",
  );
  expect(buttons[0].getAttribute("aria-label")).toBe("login.hidePassword");
  await act(async () => buttons[1].click());
  expect(container.querySelector<HTMLInputElement>("#confirm")!.type).toBe(
    "text",
  );
  expect(mocks.password).not.toHaveBeenCalled();
});
it("non invia password diverse; salva e svuota i campi solo dopo il successo", async () => {
  await fill("new", "Nuova-Password-123");
  await fill("confirm", "Diversa-Password-123");
  await submit(1);
  expect(mocks.password).not.toHaveBeenCalled();
  expect(container.textContent).toContain("changePassword.errorMismatch");
  await fill("confirm", "Nuova-Password-123");
  await submit(1);
  expect(mocks.password.mock.calls[0][0]).toEqual({
    data: { newPassword: "Nuova-Password-123" },
  });
  await act(async () => {
    mocks.password.mock.calls[0][1].onSuccess();
  });
  expect(container.querySelector<HTMLInputElement>("#new")!.value).toBe("");
  expect(container.querySelector<HTMLInputElement>("#confirm")!.value).toBe("");
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
