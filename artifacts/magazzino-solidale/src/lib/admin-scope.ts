export type RuoloAssegnabile = { nome: string; aree?: string[] };

export function ruoliNelPerimetro<T extends RuoloAssegnabile>(ruoli: T[], areeCaller: string[], isSuperAdmin: boolean): T[] {
  if (isSuperAdmin) return ruoli;
  const consentite = new Set(areeCaller);
  return ruoli.filter((ruolo) =>
    ruolo.nome !== "SuperAdmin" && (ruolo.aree ?? []).every((area) => consentite.has(area)),
  );
}
