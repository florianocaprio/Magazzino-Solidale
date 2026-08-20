export function requireGlobalBeneficiarioArea(
  isGlobal: boolean,
  selectedArea: string | undefined,
): number | undefined {
  if (!isGlobal) return undefined;
  const areaId = selectedArea ? Number(selectedArea) : NaN;
  if (!Number.isInteger(areaId) || areaId <= 0) {
    throw new Error("Seleziona l'Area del Beneficiario.");
  }
  return areaId;
}

export function canSearchBeneficiarioDuplicates(input: {
  open: boolean;
  dismissed: boolean;
  hasInput: boolean;
  isGlobal: boolean;
  areaId?: number;
}): boolean {
  return input.open
    && !input.dismissed
    && input.hasInput
    && (!input.isGlobal || input.areaId != null);
}

export function buildBeneficiarioDuplicateParams(
  nome: string | undefined,
  cognome: string | undefined,
  isGlobal: boolean,
  areaId?: number,
): { nome: string; cognome: string; areaOperativaId?: number } {
  return {
    nome: (nome ?? "").trim(),
    cognome: (cognome ?? "").trim(),
    ...(isGlobal && areaId != null ? { areaOperativaId: areaId } : {}),
  };
}
