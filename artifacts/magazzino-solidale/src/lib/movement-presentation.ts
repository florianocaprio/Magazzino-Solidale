import type { Movimento } from "@workspace/api-client-react";

// SQL DATE is a civil date, not an instant. Never pass it through Date/timezone.
export function movementCivilDate(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : value;
}

export function movementQuantity(
  movement: Pick<Movimento, "quantitaPrecisa" | "quantita">,
): string {
  return movement.quantitaPrecisa ?? String(movement.quantita);
}

// Presentation only: the canonical backend projection owns physical direction.
export function movementSign(effect: Movimento["effettoFisico"]): string {
  return effect === 1 ? "+" : effect === -1 ? "-" : effect === 0 ? "0" : "?";
}
