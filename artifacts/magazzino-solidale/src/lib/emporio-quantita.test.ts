import { describe, expect, it } from "vitest";
import { configurazioneQuantitaEmporio } from "./emporio-quantita";

describe("granularità quantità Emporio", () => {
  it("usa quantità intere e pulsanti ±1 per i pezzi", () => {
    expect(configurazioneQuantitaEmporio("pz")).toEqual({
      min: 1,
      step: 1,
      incremento: 1,
    });
  });

  it("mantiene precisione decimale per kg, g, l e ml", () => {
    expect(configurazioneQuantitaEmporio("kg")).toEqual({
      min: 0.01,
      step: 0.01,
      incremento: 0.25,
    });
    expect(configurazioneQuantitaEmporio("g")).toEqual({
      min: 0.01,
      step: 0.01,
      incremento: 1,
    });
    expect(configurazioneQuantitaEmporio("l")).toEqual({
      min: 0.01,
      step: 0.01,
      incremento: 0.25,
    });
    expect(configurazioneQuantitaEmporio("ml")).toEqual({
      min: 0.01,
      step: 0.01,
      incremento: 1,
    });
  });
});
