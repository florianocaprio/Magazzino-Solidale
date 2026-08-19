import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { loadAllPages } from "./paged-export";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("hardening UI Magazzino", () => {
  it("scorre tutte le pagine per gli export senza N+1", async () => {
    const fetchPage = vi.fn(async (page: number, limit: number) => {
      if (page === 1) return Array.from({ length: limit }, (_, index) => index + 1);
      if (page === 2) return Array.from({ length: limit }, (_, index) => index + limit + 1);
      return [201, 202, 203];
    });

    const result = await loadAllPages(fetchPage, 100);

    expect(result).toHaveLength(203);
    expect(fetchPage.mock.calls).toEqual([[1, 100], [2, 100], [3, 100]]);
  });

  it("protegge i pulsanti Carico, Scarico e Rettifica con permessi distinti", async () => {
    const [prodotti, lotti, scarichi] = await Promise.all([
      source("../pages/prodotti.tsx"),
      source("../pages/lotti.tsx"),
      source("../pages/scarichi.tsx"),
    ]);
    expect(prodotti).toContain('hasPermission("magazzino.stock.receive")');
    expect(lotti).toContain('hasPermission("magazzino.stock.receive")');
    expect(lotti).toContain('hasPermission("magazzino.stock.adjust")');
    expect(scarichi).toContain('hasPermission("magazzino.stock.issue")');
  });

  it("protegge dispatch/ricezione Trasferimenti e le azioni Bolla", async () => {
    const [trasferimenti, bolle] = await Promise.all([
      source("../pages/trasferimenti.tsx"),
      source("../pages/bolle.tsx"),
    ]);
    expect(trasferimenti).toContain('hasPermission("magazzino.transfers.dispatch")');
    expect(trasferimenti).toContain('hasPermission("magazzino.transfers.receive")');
    expect(bolle).toContain('hasPermission("bolle.manage")');
    expect(bolle).toContain('hasPermission("bolle.deliver")');
    expect(bolle).toContain('hasPermission("bolle.cancel")');
  });

  it("esclude Magazzini inattivi dai selettori delle nuove operazioni", async () => {
    const files = await Promise.all([
      source("../pages/prodotti.tsx"),
      source("../pages/lotti.tsx"),
      source("../pages/trasferimenti.tsx"),
      source("../pages/bolle.tsx"),
      source("../pages/approvvigionamenti.tsx"),
    ]);
    for (const file of files) expect(file).toMatch(/\.stato === "attivo"/);
  });
});
