import { InventoryDecimal, InventoryDecimalError } from "./inventoryDecimal";

function normalizeUnitaMisura(unitaMisura: string | null | undefined): string {
  return unitaMisura?.trim().toLowerCase() ?? "";
}

export function quantitaCompatibileConUnitaMisuraEmporio(
  quantita: string | number,
  unitaMisura: string | null | undefined,
): boolean {
  try {
    const value = InventoryDecimal.parse(quantita);
    if (!value.isPositive()) return false;
    return (
      normalizeUnitaMisura(unitaMisura) !== "pz" ||
      value.toUnits() % 1_000_000n === 0n
    );
  } catch (error) {
    if (error instanceof InventoryDecimalError) return false;
    throw error;
  }
}
