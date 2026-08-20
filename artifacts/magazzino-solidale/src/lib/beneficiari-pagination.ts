import {
  getMensaAbilitazioniRiepilogoBeneficiari,
  listBeneficiari,
  type BeneficiarioDirectory,
  type ListBeneficiariParams,
  type MensaAbilitazioneRiepilogoBeneficiario,
} from "@workspace/api-client-react";

export const BENEFICIARI_PAGE_SIZE = 50;
export const BENEFICIARI_EXPORT_PAGE_SIZE = 100;
export const MENSA_EXPORT_SUMMARY_CHUNK_SIZE = 100;

export type BeneficiarioExportRow = BeneficiarioDirectory & {
  mensaStatoExport?: string;
};

type BeneficiariPageFetcher = (
  params: ListBeneficiariParams,
) => Promise<BeneficiarioDirectory[]>;

type MensaSummaryFetcher = (params: {
  beneficiarioIds?: string;
}) => Promise<MensaAbilitazioneRiepilogoBeneficiario[]>;

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

/** Arricchisce l'export con richieste batch controllate, senza una query per beneficiario. */
export async function fetchBeneficiariExportRows(
  params: ListBeneficiariParams,
  includeMensa: boolean,
  fetchPages: (params: ListBeneficiariParams) => Promise<BeneficiarioDirectory[]> = fetchAllBeneficiariPages,
  fetchMensaSummary: MensaSummaryFetcher = getMensaAbilitazioniRiepilogoBeneficiari,
  chunkSize = MENSA_EXPORT_SUMMARY_CHUNK_SIZE,
): Promise<BeneficiarioExportRow[]> {
  const rows = await fetchPages(params);
  if (!includeMensa || rows.length === 0) return rows;

  const summaries = new Map<number, MensaAbilitazioneRiepilogoBeneficiario>();
  for (let index = 0; index < rows.length; index += chunkSize) {
    const ids = rows.slice(index, index + chunkSize).map((row) => row.id);
    const chunk = await fetchMensaSummary({ beneficiarioIds: ids.join(",") });
    for (const item of chunk) summaries.set(item.beneficiarioId, item);
  }

  return rows.map((row) => ({
    ...row,
    mensaStatoExport: summaries.get(row.id)?.stato.toUpperCase() ?? "",
  }));
}
