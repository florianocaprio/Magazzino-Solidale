import {
  getConfigurazioneAmbientePubblica,
  getGetConfigurazioneAmbientePubblicaQueryKey,
  useGetConfigurazioneAmbientePubblica,
  type ConfigurazioneAmbiente,
} from "@workspace/api-client-react";

export const FALLBACK_LOGO_URL = "/logo-aim.png";
export const FALLBACK_NOME_AMBIENTE = "Magazzino Solidale AIM";
export const FALLBACK_NOME_ASSOCIAZIONE = "Angeli in Moto";

export type BrandingAmbiente = {
  nomeAmbiente: string;
  nomeAssociazione: string;
  nomeDocumento: string;
  sottotitoloDocumento: string | null;
  contattiDocumento: string | null;
  footerDocumenti: string | null;
  logoDocumentiUrl: string;
  logoTessereUrl: string;
  indirizzo: string | null;
  comune: string | null;
  provincia: string | null;
  email: string | null;
  telefono: string | null;
  sitoWeb: string | null;
};

function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolvePublicAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function resolveBrandingImageUrl(url?: string | null, fallback = FALLBACK_LOGO_URL): string {
  const configured = clean(url);
  if (!configured) return resolvePublicAssetUrl(fallback);
  const value = configured;
  if (/^(data:|blob:|https?:\/\/|\/\/)/i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return resolvePublicAssetUrl(value);
}

export function resolveBrandingAmbiente(config?: ConfigurazioneAmbiente | null): BrandingAmbiente {
  const nomeAmbiente = clean(config?.nomeAmbiente) ?? FALLBACK_NOME_AMBIENTE;
  const nomeAssociazione = clean(config?.nomeAssociazione) ?? FALLBACK_NOME_ASSOCIAZIONE;
  const indirizzo = clean(config?.indirizzo);
  const comune = clean(config?.comune);
  const provincia = clean(config?.provincia);
  const email = clean(config?.email);
  const telefono = clean(config?.telefono);
  const sitoWeb = clean(config?.sitoWeb);

  const luogo = [comune, provincia].filter(Boolean).join(" ");
  const sede = [indirizzo, luogo].filter(Boolean).join(" - ") || null;
  const contatti = [
    telefono ? `Tel. ${telefono}` : null,
    email,
    sitoWeb,
  ].filter(Boolean).join(" - ") || null;

  return {
    nomeAmbiente,
    nomeAssociazione,
    nomeDocumento: nomeAssociazione,
    sottotitoloDocumento: nomeAmbiente !== nomeAssociazione ? nomeAmbiente : null,
    contattiDocumento: [sede, contatti].filter(Boolean).join(" - ") || null,
    footerDocumenti: clean(config?.footerDocumenti),
    logoDocumentiUrl: resolveBrandingImageUrl(config?.logoDocumentiUrl),
    logoTessereUrl: resolveBrandingImageUrl(config?.logoTessereUrl),
    indirizzo,
    comune,
    provincia,
    email,
    telefono,
    sitoWeb,
  };
}

export async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function loadFallbackLogoDataUrl(): Promise<string | null> {
  return loadImageAsDataUrl(resolvePublicAssetUrl(FALLBACK_LOGO_URL));
}

async function loadLogoWithFallback(url: string): Promise<string | null> {
  const configuredLogo = await loadImageAsDataUrl(url);
  if (configuredLogo) return configuredLogo;
  return loadFallbackLogoDataUrl();
}

export async function fetchBrandingAmbiente(options?: RequestInit): Promise<BrandingAmbiente> {
  try {
    const data = await getConfigurazioneAmbientePubblica(options);
    return resolveBrandingAmbiente(data.configurazione);
  } catch {
    return resolveBrandingAmbiente(null);
  }
}

export async function loadDocumentLogoDataUrl(branding?: BrandingAmbiente | null): Promise<string | null> {
  const resolved = branding ?? resolveBrandingAmbiente(null);
  return loadLogoWithFallback(resolved.logoDocumentiUrl);
}

export async function loadTesseraLogoDataUrl(branding?: BrandingAmbiente | null): Promise<string | null> {
  const resolved = branding ?? resolveBrandingAmbiente(null);
  return loadLogoWithFallback(resolved.logoTessereUrl);
}

export async function loadDocumentBrandingForPdf(): Promise<{ branding: BrandingAmbiente; logoDataUrl: string | null }> {
  const branding = await fetchBrandingAmbiente();
  const logoDataUrl = await loadDocumentLogoDataUrl(branding);
  return { branding, logoDataUrl };
}

export async function loadTesseraBrandingForPdf(): Promise<{ branding: BrandingAmbiente; logoDataUrl: string | null }> {
  const branding = await fetchBrandingAmbiente();
  const logoDataUrl = await loadTesseraLogoDataUrl(branding);
  return { branding, logoDataUrl };
}

export function useBrandingAmbiente() {
  const query = useGetConfigurazioneAmbientePubblica({
    query: {
      queryKey: getGetConfigurazioneAmbientePubblicaQueryKey(),
      staleTime: 60_000,
    },
  });

  return {
    ...query,
    branding: resolveBrandingAmbiente(query.data?.configurazione),
  };
}
