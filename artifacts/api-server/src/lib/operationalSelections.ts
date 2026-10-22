import type { SessionUser } from "../middlewares/auth";

type SelectionPolicy = {
  areas: string[];
  grants: string[];
  modules: string[];
  resources: string[];
};
export const OPERATIONAL_SELECTIONS: Record<string, SelectionPolicy> = {
  consegne: {
    areas: ["sociale", "logistica"],
    grants: ["consegne.view"],
    modules: ["CENTRO_ASCOLTO", "CONSEGNE"],
    resources: [
      "magazzini",
      "mezzi",
      "volontari",
      "ruoli-volontari",
      "carico-volontari",
      "stampa",
    ],
  },
  turni: {
    areas: ["sociale", "logistica"],
    grants: ["logistica.turni.view"],
    modules: ["CENTRO_ASCOLTO"],
    resources: ["mezzi", "volontari", "ruoli-volontari", "carico-volontari"],
  },
  magazzino: {
    areas: ["magazzino"],
    grants: ["magazzino.view"],
    modules: ["MAGAZZINO"],
    resources: ["fornitori", "magazzini", "volontari", "mezzi", "stampa"],
  },
  approvvigionamenti: {
    areas: ["logistica"],
    grants: ["approvvigionamenti.view"],
    modules: ["APPROVVIGIONAMENTI"],
    resources: ["prodotti", "magazzini", "fornitori"],
  },
  documenti: {
    areas: ["sociale", "magazzino"],
    grants: ["bolle.view"],
    modules: ["MAGAZZINO_SOLIDALE", "BOLLE"],
    resources: ["magazzini", "volontari", "mezzi", "stampa"],
  },
  richieste: {
    areas: ["sociale", "magazzino"],
    grants: ["richieste_magazzino.view"],
    modules: ["MAGAZZINO_SOLIDALE"],
    resources: ["magazzini", "prodotti"],
  },
  beneficiari: {
    areas: ["sociale"],
    grants: ["beneficiari.view"],
    modules: ["CENTRO_ASCOLTO"],
    resources: ["magazzini"],
  },
  emporio: {
    areas: ["emporio", "sociale", "uds"],
    grants: [
      "credito.view",
      "emporio.cassa.view",
      "emporio.sales.view",
      "emporio.access.view",
    ],
    modules: ["EMPORIO_SOLIDALE"],
    resources: ["magazzini", "stampa"],
  },
};

export function selectionPolicy(
  user: SessionUser | undefined,
  context: unknown,
  resource: string,
) {
  const rule =
    typeof context === "string" &&
    Object.hasOwn(OPERATIONAL_SELECTIONS, context)
      ? OPERATIONAL_SELECTIONS[context]
      : null;
  if (!user || !rule || !rule.resources.includes(resource)) return null;
  if (
    !user.isAdmin &&
    (!rule.areas.some((area) => user.aree.includes(area)) ||
      !rule.grants.some((grant) => user.permessi.includes(grant)))
  )
    return null;
  return rule;
}
