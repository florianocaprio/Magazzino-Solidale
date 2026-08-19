import { describe, expect, it, vi } from "vitest";
import type { BeneficiarioDirectory } from "@workspace/api-client-react";
import {
  BENEFICIARI_EXPORT_PAGE_SIZE,
  fetchAllBeneficiariPages,
} from "./beneficiari-pagination";

const rows = (start: number, count: number) => Array.from(
  { length: count },
  (_, index) => ({ id: start + index }) as BeneficiarioDirectory,
);

describe("paginazione ed export Beneficiari", () => {
  it("recupera tutte le pagine del risultato filtrato, oltre i primi 100 record", async () => {
    const fetchPage = vi.fn(async (params: { page?: number; limit?: number; search?: string }) => {
      if (params.page === 1) return rows(1, 100);
      if (params.page === 2) return rows(101, 100);
      return rows(201, 5);
    });

    const result = await fetchAllBeneficiariPages(
      { search: "rossi" },
      fetchPage,
      BENEFICIARI_EXPORT_PAGE_SIZE,
    );

    expect(result).toHaveLength(205);
    expect(result[0]?.id).toBe(1);
    expect(result[100]?.id).toBe(101);
    expect(result[204]?.id).toBe(205);
    expect(fetchPage.mock.calls.map(([params]) => params)).toEqual([
      { search: "rossi", page: 1, limit: 100 },
      { search: "rossi", page: 2, limit: 100 },
      { search: "rossi", page: 3, limit: 100 },
    ]);
  });
});
