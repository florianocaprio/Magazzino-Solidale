function normalizeUnitaMisura(unitaMisura: string | null | undefined): string {
  return unitaMisura?.trim().toLowerCase() ?? "";
}

export function quantitaCompatibileConUnitaMisuraEmporio(
  quantita: number,
  unitaMisura: string | null | undefined,
): boolean {
  if (!Number.isFinite(quantita) || quantita <= 0) return false;
  return (
    normalizeUnitaMisura(unitaMisura) !== "pz" || Number.isInteger(quantita)
  );
}
