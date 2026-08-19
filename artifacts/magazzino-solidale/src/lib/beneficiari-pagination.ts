import {
  listBeneficiari,
  type BeneficiarioDirectory,
  type ListBeneficiariParams,
} from "@workspace/api-client-react";

export const BENEFICIARI_PAGE_SIZE = 50;
export const BENEFICIARI_EXPORT_PAGE_SIZE = 100;

type BeneficiariPageFetcher = (
  params: ListBeneficiariParams,
) => Promise<BeneficiarioDirectory[]>;

/** Recupera tutte le pagine rispettando gli stessi filtri e lo scope server-side. */
export async function fetchAllBeneficiariPages(
  params: ListBeneficiariParams,
  fetchPage: BeneficiariPageFetcher = listBeneficiari,
  pageSize = BENEFICIARI_EXPORT_PAGE_SIZE,
): Promise<BeneficiarioDirectory[]> {
  const rows: BeneficiarioDirectory[] = [];
  for (let page = 1; page <= 10_000; page += 1) {
    const pageRows = await fetchPage({ ...params, page, limit: pageSize });
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
  }
  throw new Error("Esportazione interrotta: numero massimo di pagine superato.");
}
