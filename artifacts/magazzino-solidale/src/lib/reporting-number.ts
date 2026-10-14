/** Localize an exact decimal without passing its integer or fraction through Number. */
export function formatReportingDecimal(value: string, locale?: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const integer = formatter.format(BigInt(`${match[1]}${match[2]}`));
  const fraction = match[3];
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
