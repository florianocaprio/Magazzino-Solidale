import { describe, expect, it, vi } from "vitest";
import { createBeneficiarioWithOptionalMensa } from "./beneficiario-mensa-workflow";

describe("creazione Beneficiario con abilitazione Mensa opzionale", () => {
  it("crea prima il beneficiario e poi la relativa abilitazione", async () => {
    const order: string[] = [];
    const createBeneficiario = vi.fn(async () => {
      order.push("beneficiario");
      return { id: 42 };
    });
    const createMensaAbilitazione = vi.fn(async (beneficiarioId: number) => {
      order.push(`mensa:${beneficiarioId}`);
    });

    const result = await createBeneficiarioWithOptionalMensa({
      createBeneficiario,
      createMensaAbilitazione,
    });

    expect(order).toEqual(["beneficiario", "mensa:42"]);
    expect(result).toEqual({ beneficiario: { id: 42 }, mensaAbilitata: true });
  });

  it("mantiene il beneficiario e segnala il successo parziale se la seconda operazione fallisce", async () => {
    const failure = new Error("Mensa non disponibile");
    const result = await createBeneficiarioWithOptionalMensa({
      createBeneficiario: async () => ({ id: 77 }),
      createMensaAbilitazione: async () => {
        throw failure;
      },
    });

    expect(result.beneficiario.id).toBe(77);
    expect(result.mensaAbilitata).toBe(false);
    expect(result.mensaError).toBe(failure);
  });

  it("non invoca operazioni Mensa quando l'abilitazione non è richiesta", async () => {
    const createMensaAbilitazione = vi.fn();
    const result = await createBeneficiarioWithOptionalMensa({
      createBeneficiario: async () => ({ id: 9 }),
    });

    expect(createMensaAbilitazione).not.toHaveBeenCalled();
    expect(result).toEqual({ beneficiario: { id: 9 }, mensaAbilitata: false });
  });
});
