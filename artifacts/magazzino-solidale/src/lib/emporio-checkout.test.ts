import { describe, expect, it, vi } from "vitest";
import {
  scannedEmporioProduct,
  readEmporioCheckoutOutcome,
} from "./emporio-checkout";
import { configurazioneQuantitaEmporio } from "./emporio-quantita";

describe("M6.2-B scanner, quantità e recovery GET-only", () => {
  const product = { codice: "PASTA-1", codiceBarre: "123" };
  it("B20 aggiunge soltanto un codice esatto univoco", () => {
    expect(scannedEmporioProduct("123", [product])).toEqual({
      kind: "found",
      product,
    });
    expect(scannedEmporioProduct("PASTA", [product])).toEqual({
      kind: "missing",
    });
    expect(scannedEmporioProduct("sconosciuto", [product])).toEqual({
      kind: "missing",
    });
    expect(
      scannedEmporioProduct("123", [product, { ...product, codice: "ALTRO" }]),
    ).toEqual({ kind: "ambiguous" });
    expect(scannedEmporioProduct("PASTA1", [product])).toEqual({
      kind: "missing",
    });
  });
  it("B19 prevale quantitaFrazionabile, non l'etichetta", () => {
    expect(configurazioneQuantitaEmporio("kg", false).step).toBe(1);
    expect(configurazioneQuantitaEmporio("pz", true).step).toBe(0.000001);
    expect(configurazioneQuantitaEmporio("UOM sconosciuta")).toEqual({
      min: 0.01,
      step: 0.01,
      incremento: 0.25,
    });
  });
  it("B22/B24 risposta persa: Sessione chiusa poi Spesa esistente via sole GET", async () => {
    const getSession = vi
      .fn()
      .mockResolvedValue({ id: 7, statoSessione: "chiusa", spesaEmporioId: 9 });
    const getExpense = vi.fn().mockResolvedValue({ id: 9 });
    expect(
      await readEmporioCheckoutOutcome(7, getSession, getExpense),
    ).toMatchObject({ kind: "closed", expense: { id: 9 } });
    expect(getSession).toHaveBeenCalledExactlyOnceWith(7);
    expect(getExpense).toHaveBeenCalledExactlyOnceWith(7);
  });
  it("B23 rollback: nessuna ricevuta né lookup inventato", async () => {
    const getExpense = vi.fn();
    expect(
      await readEmporioCheckoutOutcome(
        7,
        async () => ({ id: 7, statoSessione: "pronta_per_chiusura" }),
        getExpense,
      ),
    ).toMatchObject({ kind: "not_closed" });
    expect(getExpense).not.toHaveBeenCalled();
  });
  it("B25 revoca o errore GET restano errori, non successo o secondo comando", async () => {
    const getExpense = vi.fn();
    await expect(
      readEmporioCheckoutOutcome(
        7,
        async () => {
          throw new Error("403");
        },
        getExpense,
      ),
    ).rejects.toThrow("403");
    expect(getExpense).not.toHaveBeenCalled();
  });
  it("respinge esiti non coerenti con la Sessione richiesta", async () => {
    await expect(
      readEmporioCheckoutOutcome(
        7,
        async () => ({ id: 8, statoSessione: "chiusa" }),
        vi.fn(),
      ),
    ).rejects.toThrow("Sessione non coerente");
    await expect(
      readEmporioCheckoutOutcome(
        7,
        async () => ({ id: 7, statoSessione: "chiusa", spesaEmporioId: 9 }),
        async () => ({ id: 10 }),
      ),
    ).rejects.toThrow("Spesa non coerente");
  });
});
