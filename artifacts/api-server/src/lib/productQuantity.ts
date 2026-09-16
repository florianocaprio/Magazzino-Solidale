import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "./inventoryDecimal";

const INVENTORY_SCALE_FACTOR = 1_000_000n;

export class ProductOperationalQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductOperationalQuantityError";
  }
}

export function defaultProductFractionalQuantity(
  unitaMisura: string | null | undefined,
): boolean {
  const unit = unitaMisura?.trim().toLocaleLowerCase("it-IT") ?? "";
  return unit === "kg" || unit === "l" || unit === "lt";
}

export function validateProductOperationalQuantity(input: {
  quantita: string | number;
  quantitaFrazionabile: boolean;
  prodottoLabel?: string | null;
}): InventoryDecimal {
  let quantity: InventoryDecimal;
  try {
    quantity = positiveInventoryDecimal(input.quantita);
  } catch (error) {
    if (error instanceof InventoryDecimalError) {
      throw new ProductOperationalQuantityError(error.message);
    }
    throw error;
  }
  if (
    !input.quantitaFrazionabile &&
    quantity.toUnits() % INVENTORY_SCALE_FACTOR !== 0n
  ) {
    const suffix = input.prodottoLabel?.trim()
      ? ` per ${input.prodottoLabel.trim()}`
      : "";
    throw new ProductOperationalQuantityError(
      `La quantità${suffix} deve essere un numero intero`,
    );
  }
  return quantity;
}
