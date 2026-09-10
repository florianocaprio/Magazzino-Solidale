import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  setUser: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useLoginUser: () => ({
    mutate: mocks.mutate,
    isPending: false,
  }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ setUser: mocks.setUser }),
}));

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ["/login", mocks.navigate],
}));

const labels: Record<string, string> = {
  "login.subtitle": "Accedi per continuare",
  "login.username": "Username",
  "login.password": "Password",
  "login.forgotPassword": "Password dimenticata?",
  "login.signIn": "Accedi",
  "login.errorInvalid": "Credenziali errate",
  "login.showPassword": "Mostra password",
  "login.hidePassword": "Nascondi password",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => labels[key] ?? key,
  }),
}));

import Login from "@/pages/login";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Login M1A", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutate.mockReset();
    mocks.setUser.mockReset();
    mocks.navigate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("mostra e nasconde la password senza cambiarne il valore o inviare il form", async () => {
    await act(async () => root.render(<Login />));

    const password = container.querySelector<HTMLInputElement>("#password");
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Mostra password"]',
    );
    if (!password || !toggle) throw new Error("Controlli password mancanti");

    await act(async () => setInputValue(password, "Segreta-123"));
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("current-password");
    expect(toggle.type).toBe("button");
    expect(toggle.tabIndex).toBe(0);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.classList.contains("focus-visible:ring-1")).toBe(true);

    await act(async () => toggle.click());
    expect(password.type).toBe("text");
    expect(password.value).toBe("Segreta-123");
    expect(toggle.getAttribute("aria-label")).toBe("Nascondi password");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(mocks.mutate).not.toHaveBeenCalled();

    await act(async () => toggle.click());
    expect(password.type).toBe("password");
    expect(password.value).toBe("Segreta-123");
    expect(toggle.getAttribute("aria-label")).toBe("Mostra password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("mantiene operativo l'invio del login e la gestione errore", async () => {
    await act(async () => root.render(<Login />));

    const username = container.querySelector<HTMLInputElement>("#username");
    const password = container.querySelector<HTMLInputElement>("#password");
    const form = container.querySelector("form");
    if (!username || !password || !form) {
      throw new Error("Form login incompleto");
    }

    await act(async () => {
      setInputValue(username, "operatore");
      setInputValue(password, "Segreta-123");
    });
    password.focus();
    await act(async () => form.requestSubmit());

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        data: {
          username: "operatore",
          password: "Segreta-123",
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    const options = mocks.mutate.mock.calls[0]?.[1] as
      | { onError?: () => void }
      | undefined;
    await act(async () => options?.onError?.());
    expect(container.textContent).toContain("Credenziali errate");
  });
});
