import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  BisogniPianificatiEditor,
  nuovoBisognoPianificato,
  type BisognoPianificatoDraft,
} from "./bisogni-pianificati-editor";

function Harness({ initial }: { initial: BisognoPianificatoDraft[] }) {
  const [value, setValue] = useState(initial);
  return <BisogniPianificatiEditor value={value} onChange={setValue} />;
}

describe("Bisogni e azioni UDS", () => {
  let root: Root;
  let container: HTMLDivElement;

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
  });

  it("crea il percorso rapido con default richiesta, da pianificare e normale", () => {
    expect(nuovoBisognoPianificato()).toMatchObject({
      tipo: "richiesta",
      stato: "da_pianificare",
      priorita: "normale",
      descrizione: "",
      dataPrevista: "",
    });
  });

  it("mostra prima la descrizione, nasconde la versione e guida Pianifica", async () => {
    const initial: BisognoPianificatoDraft[] = [
      {
        clientKey: "need-1",
        id: 1,
        versione: 3,
        tipo: "richiesta",
        descrizione: "Vestiti taglia L",
        stato: "da_pianificare",
        dataPrevista: "",
        priorita: "normale",
        note: "",
      },
    ];
    await act(async () => root.render(<Harness initial={initial} />));

    expect(document.body.textContent).toContain(
      "udsInterventi.bisognoQuickPrompt",
    );
    expect(document.body.textContent).toContain(
      "udsInterventi.advancedNeedDetails",
    );
    expect(document.body.textContent).not.toContain("v3");
    expect(document.querySelector('input[type="date"]')).toBeNull();

    const plan = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "udsInterventi.planNeedAction",
    );
    await act(async () => plan?.click());

    expect(document.querySelector('input[type="date"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      "udsInterventi.bisognoDataRequired",
    );
  });
});
