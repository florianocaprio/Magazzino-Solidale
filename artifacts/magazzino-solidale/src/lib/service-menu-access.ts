export function hasServiceMenuAccess(
  area: string,
  permission: string | undefined,
  hasArea: (area: string) => boolean,
  specialPermissions: readonly string[] = [],
): boolean {
  return hasArea(area) || Boolean(permission && specialPermissions.includes(permission));
}
