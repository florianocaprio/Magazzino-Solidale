import { describe, expect, it } from "vitest";
import {
  CommandIntentRegistry,
  shouldRetainCommandIntent,
} from "./command-intent";

function registry() {
  let sequence = 0;
  return new CommandIntentRegistry(() => `key-${++sequence}`);
}

describe("M4A — intenzione idempotente frontend", () => {
  it("riusa chiave e snapshot della richiesta per lo stesso payload semantico", () => {
    const intents = registry();
    const first = intents.prepare(
      "bolla:12:conferma",
      { bollaId: 12 },
      { versione: 3, data: { conferma: true } },
    );
    const retryAfterRefetch = intents.prepare(
      "bolla:12:conferma",
      { bollaId: 12 },
      { versione: 4, data: { conferma: true } },
    );

    expect(retryAfterRefetch).toEqual(first);
    expect(retryAfterRefetch.idempotencyKey).toBe("key-1");
    expect(retryAfterRefetch.versione).toBe(3);
  });

  it("crea una nuova chiave soltanto quando cambia l'intenzione semantica", () => {
    const intents = registry();
    const first = intents.prepare(
      "trasferimento:create",
      { origine: 1, destino: 2, righe: [{ prodottoId: 5, quantita: "4" }] },
      { versione: 1 },
    );
    const reorderedKeys = intents.prepare(
      "trasferimento:create",
      { righe: [{ quantita: "4", prodottoId: 5 }], destino: 2, origine: 1 },
      { versione: 2 },
    );
    const changed = intents.prepare(
      "trasferimento:create",
      { origine: 1, destino: 2, righe: [{ prodottoId: 5, quantita: "5" }] },
      { versione: 2 },
    );

    expect(reorderedKeys).toEqual(first);
    expect(changed.idempotencyKey).toBe("key-2");
  });

  it("mantiene l'intento dopo esito incerto e lo chiude dopo risposta HTTP", () => {
    const intents = registry();
    const first = intents.prepare("ente:create", { nome: "A" }, { nome: "A" });

    intents.fail("ente:create", { name: "ResponseParseError" });
    expect(intents.has("ente:create")).toBe(true);
    expect(
      intents.prepare("ente:create", { nome: "A" }, { nome: "A" }),
    ).toEqual(first);

    intents.fail("ente:create", { name: "ApiError", status: 409 });
    expect(intents.has("ente:create")).toBe(false);
    expect(
      intents.prepare("ente:create", { nome: "A" }, { nome: "A" })
        .idempotencyKey,
    ).toBe("key-2");
  });

  it("separa azione e aggregato anche a parità di identificativo", () => {
    const intents = registry();
    const bolla = intents.prepare("bolla:7:consegna", {}, { versione: 2 });
    const trasferimento = intents.prepare(
      "trasferimento:7:ricevi",
      {},
      { versione: 2 },
    );

    expect(bolla.idempotencyKey).toBe("key-1");
    expect(trasferimento.idempotencyKey).toBe("key-2");
  });

  it("cancella esplicitamente intenzioni concluse o abbandonate", () => {
    const intents = registry();
    intents.prepare("bolla:create", { destinatario: 1 }, {});
    intents.complete("bolla:create");
    expect(intents.has("bolla:create")).toBe(false);

    intents.prepare("bolla:create", { destinatario: 1 }, {});
    intents.discard("bolla:create");
    expect(intents.has("bolla:create")).toBe(false);
  });

  it("riconosce come incerti errori rete, abort e parse", () => {
    expect(shouldRetainCommandIntent(new TypeError("Failed to fetch"))).toBe(
      true,
    );
    expect(shouldRetainCommandIntent({ name: "AbortError" })).toBe(true);
    expect(shouldRetainCommandIntent({ name: "ResponseParseError" })).toBe(
      true,
    );
    expect(shouldRetainCommandIntent({ name: "ApiError" })).toBe(false);
  });
});
