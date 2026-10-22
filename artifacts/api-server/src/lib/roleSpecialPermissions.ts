import { ORDINARY_AREA_PERMISSION_MAP, STANDARD_ROLE_PROFILES } from "./seedRoles";

type RoleAccess = {
  aree: readonly string[];
  permessi: readonly string[];
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
};

/** Classification only: never grants permissions or rewrites persisted roles. */
export function specialRolePermissions(role: RoleAccess): string[] {
  if (role.isAdmin || role.isSuperAdmin) return [];
  const ordinary = new Set(role.aree.flatMap((area) => ORDINARY_AREA_PERMISSION_MAP[area] ?? []));
  // Reduced standard profiles (notably Volontario) include shared workflows
  // that are not all present in the area's editor preset.
  for (const profile of STANDARD_ROLE_PROFILES) {
    if (!profile.isAdmin && profile.aree.every((area) => role.aree.includes(area))) {
      for (const permission of profile.permessi) ordinary.add(permission);
    }
  }
  return [...new Set(role.permessi.filter((permission) => !ordinary.has(permission)))];
}
