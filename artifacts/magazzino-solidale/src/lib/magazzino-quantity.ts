import { formatReportingDecimal } from "./reporting-number";

/** Solo presentazione: arrotonda esattamente a due decimali, senza modificare i saldi. */
export function formatMagazzinoQuantity(
  value: string | number | null | undefined,
  locale = "it-IT",
  missing = "—",
): string {
  if (value == null || value === "") return missing;
  const source = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(source);
  if (!match) return source;
  const fraction = match[3] ?? "";
  const cents =
    BigInt(match[2]) * 100n +
    BigInt(fraction.padEnd(2, "0").slice(0, 2)) +
    (fraction[2] >= "5" ? 1n : 0n);
  return formatReportingDecimal(
    `${match[1]}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`,
    locale,
  );
}
