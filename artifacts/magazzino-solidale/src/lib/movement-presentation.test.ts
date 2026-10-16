import { expect, it } from "vitest";
import {
  movementCivilDate,
  movementQuantity,
  movementSign,
} from "./movement-presentation";
it.each([1, -1, 0, null, undefined] as const)(
  "uses only canonical effect %s",
  (effect) => {
    expect(movementSign(effect)).toBe(
      effect === 1 ? "+" : effect === -1 ? "-" : effect === 0 ? "0" : "?",
    );
  },
);
it("does not round decimal strings for UI or export", () => {
  expect(
    movementQuantity({
      quantita: 9007199254.123457,
      quantitaPrecisa: "9007199254.123456",
    }),
  ).toBe("9007199254.123456");
});
it.each(["Europe/Rome", "America/Los_Angeles"])(
  "civil date has no offset/time in %s",
  (timezone) => {
    const old = process.env.TZ;
    try {
      process.env.TZ = timezone;
      expect(movementCivilDate("2026-03-29")).toBe("29/03/2026");
      expect(movementCivilDate("2026-10-25")).toBe("25/10/2026");
    } finally {
      if (old == null) delete process.env.TZ;
      else process.env.TZ = old;
    }
  },
);
