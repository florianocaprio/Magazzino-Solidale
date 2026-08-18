import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const moduleState = vi.hoisted(() => ({
  activeCodes: new Set<string>(),
  areas: new Set<string>(),
  permissions: new Set<string>(),
  isAdmin: false,
  isSuperAdmin: false,
}));

vi.mock("@/lib/use-moduli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/use-moduli")>()),
  useConfigurazioneAmbienteFlags: () => ({
    isModuloAttivo: (codice: string) => moduleState.activeCodes.has(codice),
    isAnyModuloAttivo: (codici: readonly string[]) =>
      codici.some((codice) => moduleState.activeCodes.has(codice)),
  }),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({
    user: {
      isAdmin: moduleState.isAdmin,
      isSuperAdmin: moduleState.isSuperAdmin,
    },
    hasArea: (area: string) => moduleState.areas.has(area),
    hasPermission: (permission: string) => moduleState.permissions.has(permission),
  }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  RequireAnyModulo,
  RequireAreaModulo,
  RequireMapsAccess,
  RequireModulo,
} from "@/App";

describe("RequireModulo", () => {
  it("blocca il contenuto della route quando il modulo è disabilitato", () => {
    moduleState.activeCodes.clear();

    const html = renderToStaticMarkup(
      <RequireModulo codice="SCARICHI">
        <span>pagina scarichi</span>
      </RequireModulo>,
    );

    expect(html).toContain("superAdmin.moduleDisabled.title");
    expect(html).not.toContain("pagina scarichi");
  });

  it.each([
    { ruolo: "Admin", isAdmin: true, isSuperAdmin: false },
    { ruolo: "SuperAdmin", isAdmin: false, isSuperAdmin: true },
  ])("consente /maps a $ruolo senza aree o permessi espliciti", ({ isAdmin, isSuperAdmin }) => {
    moduleState.areas.clear();
    moduleState.permissions.clear();
    moduleState.isAdmin = isAdmin;
    moduleState.isSuperAdmin = isSuperAdmin;

    const html = renderToStaticMarkup(
      <RequireMapsAccess><span>MAPS operativa</span></RequireMapsAccess>,
    );
    expect(html).toContain("MAPS operativa");

    moduleState.isAdmin = false;
    moduleState.isSuperAdmin = false;
  });

  it("mantiene area e permesso obbligatori per /maps agli utenti standard", () => {
    moduleState.isAdmin = false;
    moduleState.isSuperAdmin = false;
    moduleState.areas.clear();
    moduleState.permissions.clear();

    const denied = renderToStaticMarkup(
      <RequireMapsAccess><span>MAPS operativa</span></RequireMapsAccess>,
    );
    expect(denied).not.toContain("MAPS operativa");

    moduleState.areas.add("sociale");
    moduleState.permissions.add("maps.operational");
    const allowed = renderToStaticMarkup(
      <RequireMapsAccess><span>MAPS operativa</span></RequireMapsAccess>,
    );
    expect(allowed).toContain("MAPS operativa");
  });

  it("rende il contenuto della route quando il modulo è abilitato", () => {
    moduleState.activeCodes.add("SCARICHI");

    const html = renderToStaticMarkup(
      <RequireModulo codice="SCARICHI">
        <span>pagina scarichi</span>
      </RequireModulo>,
    );

    expect(html).toContain("pagina scarichi");
    expect(html).not.toContain("superAdmin.moduleDisabled.title");
  });

  it("applica il prerequisito OR alle route condivise", () => {
    moduleState.activeCodes.clear();
    const blocked = renderToStaticMarkup(
      <RequireAnyModulo codici={["VOLONTARI", "MEZZI"]}>
        <span>approvazioni logistica</span>
      </RequireAnyModulo>,
    );
    expect(blocked).not.toContain("approvazioni logistica");

    moduleState.activeCodes.add("MEZZI");
    const allowed = renderToStaticMarkup(
      <RequireAnyModulo codici={["VOLONTARI", "MEZZI"]}>
        <span>approvazioni logistica</span>
      </RequireAnyModulo>,
    );
    expect(allowed).toContain("approvazioni logistica");
  });

  it("blocca la scheda condivisa al Sociale spento ma la mantiene disponibile a UDS", () => {
    moduleState.activeCodes.clear();
    moduleState.areas.clear();
    moduleState.activeCodes.add("UDS");
    moduleState.areas.add("sociale");

    const blocked = renderToStaticMarkup(
      <RequireAreaModulo
        requisiti={[
          { area: "sociale", moduloCodice: "CENTRO_ASCOLTO" },
          { area: "uds", moduloCodice: "UDS" },
        ]}
      >
        <span>scheda beneficiario</span>
      </RequireAreaModulo>,
    );
    expect(blocked).not.toContain("scheda beneficiario");

    moduleState.areas.add("uds");
    const allowed = renderToStaticMarkup(
      <RequireAreaModulo
        requisiti={[
          { area: "sociale", moduloCodice: "CENTRO_ASCOLTO" },
          { area: "uds", moduloCodice: "UDS" },
        ]}
      >
        <span>scheda beneficiario</span>
      </RequireAreaModulo>,
    );
    expect(allowed).toContain("scheda beneficiario");
  });
});
