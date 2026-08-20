import { describe, expect, it } from "vitest";
import { base } from "./i18n/namespaces/base";
import { citta } from "./i18n/namespaces/citta";
import { zoneUds } from "./i18n/namespaces/zoneUds";
import { centriAscolto } from "./i18n/namespaces/centriAscolto";
import { utenti } from "./i18n/namespaces/utenti";

describe("copy delle disattivazioni amministrative", () => {
  it("usa una azione comune di disattivazione", () => {
    expect(base.it.common.deactivate).toBe("Disattiva");
  });

  it.each([
    ["Area", citta.it.deleteTitle, citta.it.deleteDescription, citta.it.toastDeleted],
    ["Zona UDS", zoneUds.it.deleteTitle, zoneUds.it.deleteDescription, zoneUds.it.toastDeleted],
    ["Centro", centriAscolto.it.deleteTitle, centriAscolto.it.deleteDescription, centriAscolto.it.toastDeleted],
  ])("presenta %s come disattivazione reversibile", (_resource, title, description, toast) => {
    expect(title).toContain("Disattiva");
    expect(description).toContain("storico");
    expect(description).toContain("riattivat");
    expect(toast).toContain("disattivat");
  });

  it("descrive la disattivazione reversibile dell'utente", () => {
    expect(utenti.it.deleteTitle).toContain("Disattiva");
    expect(utenti.it.deleteDescAfter).toContain("storico");
    expect(utenti.it.deleteDescAfter).toContain("riattivat");
    expect(utenti.it.toastDeleted).toContain("disattivato");
  });
});
