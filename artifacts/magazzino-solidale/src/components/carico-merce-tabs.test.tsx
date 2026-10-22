import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  lots: [
    {
      id: 1,
      prodottoId: 1,
      areaOperativaId: 1,
      prodottoNome: "Prodotto preciso",
      prodottoCodice: "P1",
      quantitaCaricataPrecisa: "1.235000",
      quantitaResiduaPrecisa: "0.000001",
      quantitaPrenotataPrecisa: null,
      disponibileRealePrecisa: "0.000001",
      fondoOrigine: "NESSUN_FONDO",
      dataScadenza: null,
    },
  ],
}));
vi.mock("@/lib/use-moduli", () => ({ useConfigurazioneAmbienteFlags: () => ({ isModuloAttivo: () => true }) }));
vi.mock("@workspace/api-client-react", () => ({
  useListAreeOperative: () => ({
    data: [{ id: 1, nome: "Area", attivo: true }],
  }),
  useListMagazzini: () => ({ data: [] }),
useListMagazziniOperativi: () => ({ data: [] }),
  useListProdotti: () => ({ data: [] }),
useListProdottiOperativi: () => ({ data: [] }),
  useListFornitori: () => ({ data: [] }),
useListFornitoriOperativi: () => ({ data: [] }),
  useListLotti: () => ({ data: fixture.lots }),
  useListLottiLogici: () => ({ data: [] }),
  getListLottiLogiciQueryKey: () => ["lotti-logici"],
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ hasPermission: () => false }),
}));
vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "it", resolvedLanguage: "it" },
  }),
}));

import { CaricoMerceTabs, LottiFisiciTab } from "./carico-merce-tabs";

describe("UX-CARICO-LOTTI — navigazione Carico Merce", () => {
  it("espone esattamente tre tab con deep-link distinti", () => {
    const html = renderToStaticMarkup(<CaricoMerceTabs active="carichi" />);
    expect(html.match(/href="\/carico-merce\?tab=/g)).toHaveLength(3);
    expect(html).toContain('href="/carico-merce?tab=carichi"');
    expect(html).toContain('href="/carico-merce?tab=raccolte"');
    expect(html).toContain('href="/carico-merce?tab=lotti"');
    expect(html).toContain('aria-current="page"');
  });
});

it("BUG04: renderizza Caricata, Residuo, Prenotata e Disponibile distinguendo mancanti e zero", () => {
  window.history.replaceState(null, "", "/carico-merce?tab=lotti");
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <LottiFisiciTab />
    </QueryClientProvider>,
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  const headers = Array.from(container.querySelectorAll("th")).map(
    (el) => el.textContent,
  );
  const cells = container.querySelectorAll("tbody tr:first-child td");
  for (const [key, expected] of [
    ["loadedQuantity", "1,24"],
    ["residual", "0,00"],
    ["reserved", "—"],
    ["availableQuantity", "0,00"],
  ]) {
    expect(cells[headers.indexOf(`uxCaricoLotti.${key}`)].textContent).toBe(
      expected,
    );
  }
  expect(container.textContent).toContain("uxCaricoLotti.available");
  expect(fixture.lots[0].quantitaResiduaPrecisa).toBe("0.000001");
});
