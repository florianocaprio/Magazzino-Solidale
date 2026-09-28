import { describe, expect, it } from "vitest";
import { shouldFetchBollaBeneficiari } from "./bolle-beneficiari-query";

describe("directory Beneficiari nella Bolla", () => {
  it("attende il collegamento prima del fetch iniziale", () => {
    expect(shouldFetchBollaBeneficiari(true, null)).toBe(false);
  });

  it("non richiede la directory per una Bolla contestualizzata", () => {
    expect(shouldFetchBollaBeneficiari(true, true)).toBe(false);
  });

  it("la consente solo per una Bolla libera con permesso esplicito", () => {
    expect(shouldFetchBollaBeneficiari(true, false)).toBe(true);
    expect(shouldFetchBollaBeneficiari(false, false)).toBe(false);
  });
});
