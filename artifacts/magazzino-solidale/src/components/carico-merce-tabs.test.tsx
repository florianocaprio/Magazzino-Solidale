import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CaricoMerceTabs } from "./carico-merce-tabs";

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
