import { InventoryDecimal } from "./inventoryDecimal";

/** numeric(10,2) is legacy storage, not a fractional-credit contract. */
export const MAX_CREDITO = 99_999_999;
export class CreditoInteroError extends Error {
  readonly status = 400;
}

export function creditoIntero(
  value: unknown,
  options: { signed?: boolean; positive?: boolean } = {},
): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new CreditoInteroError("Credito assente o non valido.");
  const text = String(value).trim().replace(",", ".");
  const match = /^([+-]?)(\d+)(?:\.(0+))?$/.exec(text);
  if (!match || text.length > 100)
    throw new CreditoInteroError(
      "Il Credito Solidale deve essere espresso in unità intere, senza arrotondamenti.",
    );
  const exact = BigInt(`${match[1]}${match[2]}`);
  if (exact > BigInt(MAX_CREDITO) || exact < -BigInt(MAX_CREDITO))
    throw new CreditoInteroError("Credito fuori dal limite consentito.");
  if ((!options.signed && exact < 0n) || (options.positive && exact <= 0n))
    throw new CreditoInteroError(
      "Segno o zero non ammesso per questa operazione di credito.",
    );
  return Number(exact);
}

export function creditoPerQuantita(
  unitario: unknown,
  quantita: string | number,
): number {
  const product =
    BigInt(creditoIntero(unitario, { positive: true })) *
    InventoryDecimal.parse(quantita).toUnits();
  if (product % 1_000_000n !== 0n)
    throw new CreditoInteroError(
      "Quantità × credito produce una frazione di credito. Non è prevista una regola di arrotondamento: modifica consapevolmente la quantità o richiedi una decisione sulla policy.",
    );
  return creditoIntero(String(product / 1_000_000n), { positive: true });
}

/** Technical allocation only: cumulative integral portions, exact final sum.
 * Refund entitlement MUST use the original economic row, never this allocation.
 */
export function quotaTecnicaCredito(
  total: unknown,
  cumulative: InventoryDecimal,
  previous: InventoryDecimal,
  original: InventoryDecimal,
): number {
  const credit = BigInt(creditoIntero(total));
  return Number(
    (credit * cumulative.toUnits()) / original.toUnits() -
      (credit * previous.toUnits()) / original.toUnits(),
  );
}
