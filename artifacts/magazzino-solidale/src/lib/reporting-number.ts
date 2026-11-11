const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Localize a decimal without losing precision through Number. */
export function formatReportingDecimal(
  value: string,
  locale?: string,
  presentation: "exact" | "trim" | "ceil" = "exact",
): string {
  const match = decimalPattern.exec(value);
  if (!match) return value;
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const whole = BigInt(`${match[1]}${match[2]}`);
  const fraction =
    presentation === "exact" ? match[3] : match[3]?.replace(/0+$/, "");
  if (presentation === "ceil")
    return formatter.format(whole + (!match[1] && fraction ? 1n : 0n));
  const integer = formatter.format(whole);
  if (!fraction) return integer;
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value ?? ".";
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  const minus =
    match[1] && BigInt(match[2]) === 0n
      ? new Intl.NumberFormat(locale)
          .formatToParts(-1)
          .filter((p) => p.type === "minusSign" || p.type === "literal")
          .map((p) => p.value)
          .join("")
      : "";
  return `${minus}${integer}${decimal}${[...fraction].map((d) => digits.format(Number(d))).join("")}`;
}

export function equalReportingDecimals(left: string, right: string): boolean {
  const a = decimalPattern.exec(left);
  const b = decimalPattern.exec(right);
  if (!a || !b) return false;
  const fractionA = (a[3] ?? "").replace(/0+$/, "");
  const fractionB = (b[3] ?? "").replace(/0+$/, "");
  return (
    BigInt(`${a[1]}${a[2]}`) === BigInt(`${b[1]}${b[2]}`) &&
    fractionA === fractionB &&
    (!fractionA || a[1] === b[1])
  );
}

export function formatLogisticsQuantity(
  value: unknown,
  unit: unknown,
  locale?: string,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const measure = typeof unit === "string" ? unit.trim().toLowerCase() : "";
  if (["kg", "l", "lt"].includes(measure))
    return formatReportingDecimal(String(value), locale, "ceil");
  if (measure === "pz")
    return formatReportingDecimal(String(value), locale, "trim");
  return undefined;
}
