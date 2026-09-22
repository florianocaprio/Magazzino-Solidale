export type AdministrativeReversalGate = {
  canReverseAdmin: boolean;
  documentStatus: string;
  selectedRowIds: readonly number[];
  reason: string;
  confirmation: string;
  documentNumber: string;
};

export function administrativeReversalReady({
  canReverseAdmin,
  documentStatus,
  selectedRowIds,
  reason,
  confirmation,
  documentNumber,
}: AdministrativeReversalGate): boolean {
  return (
    canReverseAdmin &&
    documentStatus === "consegnato" &&
    selectedRowIds.length > 0 &&
    reason.trim().length > 0 &&
    confirmation.trim() === documentNumber
  );
}
