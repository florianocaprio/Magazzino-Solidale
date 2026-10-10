/** UI preview only. The server revalidates all economic/physical effects. */
export function creditoInteroInput(value: string): number | null {
  if (!/^[+-]?\d+(?:[.,]0+)?$/.test(value.trim())) return null;
  const amount = Number(value.replace(",", "."));
  return Number.isSafeInteger(amount) && Math.abs(amount) <= 99_999_999
    ? amount
    : null;
}

export function previewRimborso(
  righe: Array<{
    id: number;
    sessioneCassaRigaId?: number | null;
    quantita: number;
    creditoTotale: number;
    quantitaStornabile: number;
  }>,
  selected: Record<number, number>,
  residualCredit: number,
): number | null {
  if (!Number.isSafeInteger(residualCredit) || residualCredit < 0) return null;
  const units = (value: number) => {
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value));
    return match
      ? BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"))
      : null;
  };
  const groups = new Map<
    number,
    { quantity: bigint; selected: bigint; credit: bigint }
  >();
  let full = true;
  for (const row of righe) {
    const quantity = units(row.quantita),
      requested = units(selected[row.id] ?? 0);
    if (
      quantity == null ||
      requested == null ||
      !Number.isSafeInteger(row.creditoTotale) ||
      requested > (units(row.quantitaStornabile) ?? -1n)
    )
      return null;
    full &&= requested === units(row.quantitaStornabile);
    const id = row.sessioneCassaRigaId ?? row.id;
    const group = groups.get(id) ?? { quantity: 0n, selected: 0n, credit: 0n };
    group.quantity += quantity;
    group.selected += requested;
    group.credit += BigInt(row.creditoTotale);
    groups.set(id, group);
  }
  if (full)
    return Number.isSafeInteger(residualCredit) && residualCredit >= 0
      ? residualCredit
      : null;
  let result = 0n;
  for (const group of groups.values()) {
    const numerator = group.credit * group.selected;
    if (group.quantity === 0n || numerator % group.quantity !== 0n) return null;
    result += numerator / group.quantity;
  }
  return result <= BigInt(residualCredit) ? Number(result) : null;
}
