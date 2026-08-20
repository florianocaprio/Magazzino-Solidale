export type RuoloAssegnabile = { nome: string; aree?: string[] };

export type AdminTerritorialScope = {
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  areaOperativaId?: number | null;
};

export function canManageGlobalAdminResources(user: AdminTerritorialScope | null | undefined): boolean {
  return Boolean(user && (user.isAdmin || user.isSuperAdmin) && user.areaOperativaId == null);
}

export function ruoliNelPerimetro<T extends RuoloAssegnabile>(ruoli: T[], areeCaller: string[], isSuperAdmin: boolean): T[] {
  if (isSuperAdmin) return ruoli;
  const consentite = new Set(areeCaller);
  return ruoli.filter((ruolo) => ruolo.nome !== "SuperAdmin" && (ruolo.aree ?? []).every((area) => consentite.has(area)));
}
