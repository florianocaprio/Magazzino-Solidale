import { describe, expect, it } from "vitest";
import {
  authUserCanOperateBolle,
  authUserHasArea,
  authUserHasPermission,
} from "./auth";

describe("controlli accesso auth", () => {
  it("riconosce il permesso di un utente non-admin", () => {
    const user = {
      isAdmin: false,
      aree: ["magazzino"],
      permessi: ["magazzino.view"],
    };

    expect(authUserHasPermission(user, "magazzino.view")).toBe(true);
    expect(authUserHasPermission(user, "magazzino.stock.issue")).toBe(false);
    expect(authUserHasArea(user, "magazzino")).toBe(true);
    expect(authUserHasArea(user, "amministrazione")).toBe(false);
  });

  it("nega senza eccezioni una risposta temporaneamente priva di liste", () => {
    const incompleteUser = { isAdmin: false };

    expect(() =>
      authUserHasPermission(incompleteUser, "magazzino.view"),
    ).not.toThrow();
    expect(() => authUserHasArea(incompleteUser, "magazzino")).not.toThrow();
    expect(authUserHasPermission(incompleteUser, "magazzino.view")).toBe(false);
    expect(authUserHasArea(incompleteUser, "magazzino")).toBe(false);
  });

  it("mantiene il bypass admin anche senza liste", () => {
    const admin = { isAdmin: true };

    expect(authUserHasPermission(admin, "magazzino.stock.issue")).toBe(true);
    expect(authUserHasArea(admin, "amministrazione")).toBe(true);
  });

  it("M5C1: vecchi grant Bolla non riaprono la creazione al solo Sociale", () => {
    const social = {
      isAdmin: false,
      aree: ["sociale"],
      permessi: ["bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel"],
    };
    expect(authUserCanOperateBolle(social, "bolle.manage")).toBe(false);
    expect(authUserCanOperateBolle(social, "bolle.deliver")).toBe(false);
    expect(authUserCanOperateBolle(social, "bolle.cancel")).toBe(false);
    expect(
      authUserCanOperateBolle(
        { ...social, aree: ["sociale", "magazzino"] },
        "bolle.manage",
      ),
    ).toBe(true);
    expect(authUserCanOperateBolle({ isAdmin: true }, "bolle.manage")).toBe(
      true,
    );
  });
});
