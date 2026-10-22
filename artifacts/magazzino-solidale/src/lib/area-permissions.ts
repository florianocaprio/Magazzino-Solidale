export type AreaPermissionDefinition = {
  key: string;
  permessi?: readonly string[];
  permessiOrdinari?: readonly string[];
};

export type RoleAccessSelection = {
  aree: string[];
  permessi: string[];
};

export type AreaCheckboxState = boolean | "indeterminate";

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function permissionsForArea(
  catalog: readonly AreaPermissionDefinition[],
  areaKey: string,
): string[] {
  return unique(catalog.find((area) => area.key === areaKey)?.permessi ?? []);
}

export function ordinaryPermissionsForArea(catalog: readonly AreaPermissionDefinition[], areaKey: string): string[] {
  const area = catalog.find((item) => item.key === areaKey);
  return unique(area?.permessiOrdinari ?? area?.permessi ?? []);
}

export function roleConfigurationWarnings(selection: RoleAccessSelection, catalog: readonly AreaPermissionDefinition[]): string[] {
  const available = new Set(selection.aree.flatMap((key) => permissionsForArea(catalog, key)));
  const orphaned = selection.permessi.filter((key) => !available.has(key));
  const warnings = orphaned.length ? [`Permessi senza un servizio associato o non riconosciuti (conservati): ${orphaned.join(", ")}`] : [];
  for (const [action, view] of [["fornitori.manage", "fornitori.view"], ["magazzino.stock.receive", "magazzino.view"], ["logistica.turni.manage", "logistica.turni.view"], ["consegne.manage", "consegne.view"]]) {
    if (selection.permessi.includes(action) && !selection.permessi.includes(view)) warnings.push(`${action} richiede anche ${view} per il workflow completo.`);
  }
  return warnings;
}

export function existingRoleSelection(
  selection: RoleAccessSelection,
): RoleAccessSelection {
  // Opening a role must preserve its persisted grants exactly. Suggestions are
  // applied only by applyAreaSelection after an explicit Area interaction.
  return {
    aree: [...selection.aree],
    permessi: [...selection.permessi],
  };
}

export function applyAreaSelection(
  selection: RoleAccessSelection,
  areaKey: string,
  checked: boolean,
  catalog: readonly AreaPermissionDefinition[],
): RoleAccessSelection {
  const areaPermissions = new Set(ordinaryPermissionsForArea(catalog, areaKey));

  if (checked) {
    return {
      aree: unique([...selection.aree, areaKey]),
      permessi: unique([...selection.permessi, ...areaPermissions]),
    };
  }

  const remainingAreas = selection.aree.filter((area) => area !== areaKey);
  const permissionsRequiredElsewhere = new Set(
    remainingAreas.flatMap((area) => ordinaryPermissionsForArea(catalog, area)),
  );

  return {
    aree: remainingAreas,
    permessi: selection.permessi.filter(
      (permission) =>
        !areaPermissions.has(permission) ||
        permissionsRequiredElsewhere.has(permission),
    ),
  };
}

export function applyPermissionSelection(
  permissions: readonly string[],
  permission: string,
  checked: boolean,
): string[] {
  return checked
    ? unique([...permissions, permission])
    : permissions.filter((key) => key !== permission);
}

export function applyAllAreaPermissions(
  permissions: readonly string[],
  areaKey: string,
  checked: boolean,
  catalog: readonly AreaPermissionDefinition[],
  selectedAreas: readonly string[] = [],
): string[] {
  const areaPermissions = ordinaryPermissionsForArea(catalog, areaKey);
  if (checked) return unique([...permissions, ...areaPermissions]);
  const areaPermissionSet = new Set(areaPermissions);
  const shared = new Set(selectedAreas.filter((area) => area !== areaKey).flatMap((area) => ordinaryPermissionsForArea(catalog, area)));
  return permissions.filter((permission) => !areaPermissionSet.has(permission) || shared.has(permission));
}

export function areaCheckboxState(
  areaKey: string,
  selectedAreas: readonly string[],
  selectedPermissions: readonly string[],
  catalog: readonly AreaPermissionDefinition[],
): AreaCheckboxState {
  if (!selectedAreas.includes(areaKey)) return false;
  const areaPermissions = ordinaryPermissionsForArea(catalog, areaKey);
  if (areaPermissions.length === 0) return true;
  return areaPermissions.every((permission) =>
    selectedPermissions.includes(permission),
  )
    ? true
    : "indeterminate";
}
