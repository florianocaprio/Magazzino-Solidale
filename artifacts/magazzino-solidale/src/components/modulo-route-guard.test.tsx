import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const moduleState = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/use-moduli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/use-moduli")>()),
  useConfigurazioneAmbienteFlags: () => ({
    isModuloAttivo: () => moduleState.enabled,
  }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { RequireModulo } from "@/App";

describe("RequireModulo", () => {
  it("blocca il contenuto della route quando il modulo è disabilitato", () => {
    moduleState.enabled = false;

    const html = renderToStaticMarkup(
      <RequireModulo codice="SCARICHI">
        <span>pagina scarichi</span>
      </RequireModulo>,
    );

    expect(html).toContain("superAdmin.moduleDisabled.title");
    expect(html).not.toContain("pagina scarichi");
  });

  it("rende il contenuto della route quando il modulo è abilitato", () => {
    moduleState.enabled = true;

    const html = renderToStaticMarkup(
      <RequireModulo codice="SCARICHI">
        <span>pagina scarichi</span>
      </RequireModulo>,
    );

    expect(html).toContain("pagina scarichi");
    expect(html).not.toContain("superAdmin.moduleDisabled.title");
  });
});
