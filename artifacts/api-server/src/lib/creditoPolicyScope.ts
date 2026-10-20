export function creditoPolicyApplicable(
  policy: { attiva: boolean; areaOperativaId: number | null; centroAscoltoId: number | null },
  beneficiary: { areaOperativaId: number | null; centroAscoltoId: number | null },
) {
  return policy.attiva &&
    (policy.areaOperativaId == null || policy.areaOperativaId === beneficiary.areaOperativaId) &&
    (policy.centroAscoltoId == null || policy.centroAscoltoId === beneficiary.centroAscoltoId);
}
