import type { AuthUser } from "@workspace/api-client-react";

type MapsUser = Pick<AuthUser, "isAdmin" | "isSuperAdmin"> | null | undefined;

export function isMapsApplicationAdministrator(user: MapsUser): boolean {
  return user?.isAdmin === true || user?.isSuperAdmin === true;
}

export function hasMapsPermission(
  user: MapsUser,
  hasPermission: (permission: string) => boolean,
  permission: string,
): boolean {
  return isMapsApplicationAdministrator(user) || hasPermission(permission);
}

export function canAccessMapsApplication(
  user: MapsUser,
  hasArea: (area: string) => boolean,
  hasPermission: (permission: string) => boolean,
): boolean {
  if (isMapsApplicationAdministrator(user)) return true;
  return hasPermission("maps.operational")
    && (hasArea("sociale") || hasArea("magazzino"));
}

export function canShowMapsNavigation(
  user: MapsUser,
  hasArea: (area: string) => boolean,
  hasPermission: (permission: string) => boolean,
  mapsLayerCount: number,
): boolean {
  return mapsLayerCount > 0
    && canAccessMapsApplication(user, hasArea, hasPermission);
}
