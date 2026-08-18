import { describe, expect, it } from "vitest";
import {
  canAccessMapsApplication,
  canShowMapsNavigation,
  hasMapsPermission,
} from "@/lib/maps-access";

const denied = () => false;

describe("accesso applicativo MAPS", () => {
  it.each([
    { label: "Admin", user: { isAdmin: true, isSuperAdmin: false } },
    { label: "SuperAdmin", user: { isAdmin: false, isSuperAdmin: true } },
  ])("mostra il menu a $label senza aree o permessi espliciti", ({ user }) => {
    expect(canAccessMapsApplication(user, denied, denied)).toBe(true);
    expect(canShowMapsNavigation(user, denied, denied, 1)).toBe(true);
    expect(hasMapsPermission(user, denied, "maps.route")).toBe(true);
  });

  it("continua a richiedere area e permesso all'utente standard", () => {
    const user = { isAdmin: false, isSuperAdmin: false };
    const sociale = (area: string) => area === "sociale";
    const operational = (permission: string) => permission === "maps.operational";

    expect(canAccessMapsApplication(user, sociale, operational)).toBe(true);
    expect(canAccessMapsApplication(user, denied, operational)).toBe(false);
    expect(canAccessMapsApplication(user, sociale, denied)).toBe(false);
    expect(canShowMapsNavigation(user, sociale, operational, 0)).toBe(false);
  });
});
