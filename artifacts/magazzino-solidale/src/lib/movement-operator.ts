export function movementOperatorLabel(
  operatorCode: string | null | undefined,
  unavailableLabel: string,
): string {
  return operatorCode?.trim() || unavailableLabel;
}
