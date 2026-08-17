import { describe, expect, it } from "vitest";
import { reporting } from "./i18n/namespaces/reporting";
import { localizeReportingText } from "./reporting-text";

type Locale = keyof typeof reporting;

function translator(locale: Locale) {
  return (key: string, options?: Record<string, unknown>) => {
    const value = key
      .split(".")
      .slice(1)
      .reduce<unknown>((current, segment) =>
        typeof current === "object" && current != null
          ? (current as Record<string, unknown>)[segment]
          : undefined, reporting[locale]);
    return typeof value === "string"
      ? value.replace("{{date}}", String(options?.date ?? ""))
      : key;
  };
}

describe("testi descrittivi della reportistica", () => {
  it.each<Locale>(["it", "es", "en", "fr", "de", "ar"])(
    "localizza definizioni, note, stati e date in %s",
    (locale) => {
      const t = translator(locale);
      expect(localizeReportingText(t, "Spesa Emporio = record spese_emporio nello stato chiusa.")).not.toContain(
        "reporting.text",
      );
      expect(localizeReportingText(t, "Senza lotto non è possibile attribuire con certezza la provenienza FSE+.")).not.toContain(
        "reporting.text",
      );
      expect(localizeReportingText(t, "MANCANTE")).not.toContain("reporting.status");
      expect(localizeReportingText(t, "Reference date 2026-08-17")).toContain("2026-08-17");
    },
  );

  it("non traduce dati di dominio arbitrari", () => {
    expect(localizeReportingText(translator("en"), "Nome prodotto inserito dall'operatore")).toBe(
      "Nome prodotto inserito dall'operatore",
    );
  });
});
