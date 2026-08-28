import { describe, expect, it } from "vitest";
import {
  canReactivateVolunteer,
  canSuspendVolunteer,
} from "./volontari-actions";

const state = (
  overrides: Partial<{
    statoApprovazione: string;
    sospesoManualmente: boolean;
    abilitatoAmministrativamente: boolean;
  }> = {},
) => ({
  statoApprovazione: "approvato",
  sospesoManualmente: false,
  abilitatoAmministrativamente: true,
  ...overrides,
});

describe("azioni contestuali volontari", () => {
  it.each(["in_attesa", "respinto"])(
    "non espone sospensione o riattivazione per stato %s",
    (statoApprovazione) => {
      const volunteer = state({
        statoApprovazione,
        abilitatoAmministrativamente: false,
      });
      expect(canSuspendVolunteer(volunteer)).toBe(false);
      expect(canReactivateVolunteer(volunteer)).toBe(false);
    },
  );

  it("espone sospendi soltanto per un approvato amministrativamente attivo", () => {
    expect(canSuspendVolunteer(state())).toBe(true);
    expect(canReactivateVolunteer(state())).toBe(false);
  });

  it("espone riattiva soltanto dopo una sospensione reale", () => {
    const volunteer = state({
      sospesoManualmente: true,
      abilitatoAmministrativamente: false,
    });
    expect(canSuspendVolunteer(volunteer)).toBe(false);
    expect(canReactivateVolunteer(volunteer)).toBe(true);
  });

  it("non espone sospendi se il flag amministrativo è disabilitato senza sospensione", () => {
    const volunteer = state({ abilitatoAmministrativamente: false });
    expect(canSuspendVolunteer(volunteer)).toBe(false);
    expect(canReactivateVolunteer(volunteer)).toBe(false);
  });
});
