import { InventoryDecimal } from "./inventoryDecimal";

/** Infer only from the two quantities of the same movement, never its name. */
export function inferFseUnitFactor(
  pieces: string | null,
  kgLt: string | null,
): string | null {
  if (pieces == null || kgLt == null) return null;
  const p = InventoryDecimal.parse(pieces).toUnits();
  const k = InventoryDecimal.parse(kgLt).toUnits();
  if (p <= 0n || k <= 0n) return null;
  const scale = 1_000_000_000n;
  const ratio = (k * scale + p / 2n) / p;
  if (ratio <= 0n) return null;
  // The caller must still validate that this factor reproduces both quantities.
  return `${ratio / scale}.${String(ratio % scale).padStart(9, "0")}`;
}
