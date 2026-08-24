export type AreaPermissionDefinition = {
  key: string;
  permessi?: readonly string[];
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
  const areaPermissions = new Set(permissionsForArea(catalog, areaKey));

  if (checked) {
    return {
      aree: unique([...selection.aree, areaKey]),
      permessi: unique([...selection.permessi, ...areaPermissions]),
    };
  }

  const remainingAreas = selection.aree.filter((area) => area !== areaKey);
  const permissionsRequiredElsewhere = new Set(
    remainingAreas.flatMap((area) => permissionsForArea(catalog, area)),
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
): string[] {
  const areaPermissions = permissionsForArea(catalog, areaKey);
  if (checked) return unique([...permissions, ...areaPermissions]);
  const areaPermissionSet = new Set(areaPermissions);
  return permissions.filter((permission) => !areaPermissionSet.has(permission));
}

export function areaCheckboxState(
  areaKey: string,
  selectedAreas: readonly string[],
  selectedPermissions: readonly string[],
  catalog: readonly AreaPermissionDefinition[],
): AreaCheckboxState {
  if (!selectedAreas.includes(areaKey)) return false;
  const areaPermissions = permissionsForArea(catalog, areaKey);
  if (areaPermissions.length === 0) return true;
  return areaPermissions.every((permission) =>
    selectedPermissions.includes(permission),
  )
    ? true
    : "indeterminate";
}
