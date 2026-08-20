export type PermissionChecker = (permission: string) => boolean;

export function cassaEmporioCapabilities(hasPermission: PermissionChecker) {
  return {
    canOperate: hasPermission("emporio.cassa.operate"),
    canForce: hasPermission("emporio.cassa.force"),
    canAdjustCredito: hasPermission("credito.adjust"),
  };
}

export function speseEmporioCapabilities(hasPermission: PermissionChecker) {
  return {
    canManage: hasPermission("emporio.sales.manage"),
    canReverse: hasPermission("emporio.sales.reverse"),
  };
}
