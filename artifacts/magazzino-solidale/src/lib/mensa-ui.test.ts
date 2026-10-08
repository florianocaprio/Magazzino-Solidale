import { describe, expect, it } from "vitest";
import { mensaErrorMessage } from "./mensa-ui";
import { CommandIntentRegistry } from "./command-intent";

describe("M6.1 intenzioni ed errori", () => {
  it("conserva chiave e payload dopo risposta persa post-commit; nuova intenzione dopo successo", () => {
    let sequence = 0;
    const registry = new CommandIntentRegistry(() => `consume-${++sequence}`);
    const payload = {
      mensaId: 1,
      prodottoId: 2,
      quantita: "0.3",
      tipoServizio: "pranzo",
    };
    const first = registry.prepare("consumo", payload, payload);
    registry.fail("consumo", new TypeError("Risposta persa dopo commit"));
    expect(registry.prepare("consumo", payload, payload)).toEqual(first);
    registry.complete("consumo");
    expect(
      registry.prepare("consumo", payload, payload).idempotencyKey,
    ).not.toBe(first.idempotencyKey);
  });
  it("preferisce il messaggio backend contestuale al messaggio generico", () => {
    expect(
      mensaErrorMessage({
        response: { data: { error: "Servizio chiuso" } },
        message: "HTTP 409",
      }),
    ).toBe("Servizio chiuso");
    expect(
      mensaErrorMessage({
        data: { error: "Assegnazione revocata" },
        response: { data: { error: "altro" } },
      }),
    ).toBe("Assegnazione revocata");
  });
});
