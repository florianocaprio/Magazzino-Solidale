import { describe, expect, it, vi } from "vitest";
import { createBeneficiarioWithOptionalMensa, createBeneficiarioWithOptionalServices } from "./beneficiario-mensa-workflow";

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


describe("BUG05 — creazione e recupero Mensa + Emporio sullo stesso ID", () => {
  it.each(["mensa", "emporio"])("recupera soltanto %s dopo il fallimento, mantenendo l'altro diritto", async (failed) => {
    const createBeneficiario = vi.fn(async () => ({ id: 912 }));
    const mensa = vi.fn(async (_id: number) => { if (failed === "mensa") throw new Error("Mensa indisponibile"); });
    const emporio = vi.fn(async (_id: number) => { if (failed === "emporio") throw new Error("Emporio indisponibile"); });
    const first = await createBeneficiarioWithOptionalServices({ createBeneficiario, createMensaAbilitazione: mensa, createEmporioAbilitazione: emporio });
    expect(first.beneficiario.id).toBe(912);
    expect(first.mensaAbilitata).toBe(failed !== "mensa");
    expect(first.emporioAbilitato).toBe(failed !== "emporio");
    mensa.mockImplementation(async () => {}); emporio.mockImplementation(async () => {});
    const recovered = await createBeneficiarioWithOptionalServices({ createBeneficiario, previous: first, createMensaAbilitazione: mensa, createEmporioAbilitazione: emporio });
    expect(createBeneficiario).toHaveBeenCalledTimes(1);
    expect(mensa).toHaveBeenCalledTimes(failed === "mensa" ? 2 : 1);
    expect(emporio).toHaveBeenCalledTimes(failed === "emporio" ? 2 : 1);
    expect(recovered).toEqual({ beneficiario: { id: 912 }, mensaAbilitata: true, emporioAbilitato: true });
    expect(mensa).toHaveBeenCalledWith(912); expect(emporio).toHaveBeenCalledWith(912);
  });
  it("fallimento anagrafica: nessuna abilitazione e nessun falso ID", async () => {
    const rights = vi.fn();
    await expect(createBeneficiarioWithOptionalServices({ createBeneficiario: async () => { throw new Error("Non salvata"); }, createMensaAbilitazione: rights, createEmporioAbilitazione: rights })).rejects.toThrow("Non salvata");
    expect(rights).not.toHaveBeenCalled();
  });
});
