/** Il Centro anagrafico non limita i servizi abilitati nella propria Area. */
export function operationalCentroId(
  user:
    | {
        areaOperativaId?: number | null;
        centroAscoltoId?: number | null;
        aree?: string[] | null;
      }
    | null
    | undefined,
): number | null {
  if (
    user?.areaOperativaId != null &&
    user.aree?.some((area) => ["sociale", "mensa", "emporio"].includes(area))
  )
    return null;
  return user?.centroAscoltoId ?? null;
}
