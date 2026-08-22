import type {
  AgeaImportRighePage,
  AgeaImportazione,
  AnalyzeAgeaImportazioneParams,
} from "./generated/api.schemas";
import { analyzeAgeaImportazione } from "./generated/api";
import { customFetch } from "./custom-fetch";

export const AGEA_XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Adapter binario per l'upload AGEA. Orval 8 serializza i body non-form come
 * JSON anche quando OpenAPI dichiara format: binary; questo confine mantiene
 * il contratto generato per parametri/risposta ma invia i byte del Blob.
 */
export function analyzeAgeaImportazioneBinary(
  file: Blob,
  params: AnalyzeAgeaImportazioneParams,
): Promise<AgeaImportazione> {
  return analyzeAgeaImportazione(file, params);
}

export function listAgeaImportazioneRigheFiltered(
  id: number,
  filters: {
    page?: number;
    pageSize?: number;
    stato?: string;
    fondo?: string;
    tipo?: string;
    q?: string;
  } = {},
): Promise<AgeaImportRighePage> {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value != null && value !== "") query.set(key, String(value));
  });
  const suffix = query.size ? `?${query.toString()}` : "";
  return customFetch<AgeaImportRighePage>(
    `/api/agea/importazioni/${id}/righe${suffix}`,
    { responseType: "json" },
  );
}
