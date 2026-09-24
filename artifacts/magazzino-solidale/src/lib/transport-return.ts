export const RETURN_FIELDS = [
  "idonea",
  "deteriorata",
  "scaduta",
  "mancante",
  "rubata",
] as const;
export type ReturnField = (typeof RETURN_FIELDS)[number];

/** Exact six-decimal input arithmetic shared by the return form and its tests. */
export function returnQuantityUnits(raw: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{1,6}))?$/.exec(raw.trim());
  if (!match) return null;
  return (
    BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}

export function formatReturnUnits(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = String(absolute % 1_000_000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export function returnLineDifference(
  outbound: string,
  values: Record<ReturnField, string>,
): bigint | null {
  const original = returnQuantityUnits(outbound);
  if (original == null) return null;
  let classified = 0n;
  for (const field of RETURN_FIELDS) {
    const parsed = returnQuantityUnits(values[field] || "0");
    if (parsed == null) return null;
    classified += parsed;
  }
  return original - classified;
}
