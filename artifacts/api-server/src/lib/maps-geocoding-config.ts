type MapsGeocodingMode = "public" | "custom" | "disabled";

export type MapsGeocodingConfig = {
  baseUrl: string;
  mode: MapsGeocodingMode;
  providerHost: string;
  publicAllowed: boolean;
  rateLimitMs: number;
  userAgent: string;
};

const PUBLIC_NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const PUBLIC_NOMINATIM_HOST = "nominatim.openstreetmap.org";
const DEFAULT_NOMINATIM_USER_AGENT =
  "MagazzinoSolidale/2.1 (+https://magazzino.angeliinmoto.it)";
const PUBLIC_RATE_LIMIT_MS = 1_100;

export function resolveMapsGeocodingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MapsGeocodingConfig {
  const configuredBaseUrl = environment.NOMINATIM_BASE_URL?.trim();
  const baseUrl = (configuredBaseUrl || PUBLIC_NOMINATIM_URL).replace(
    /\/+$/,
    "",
  );
  const configuredPublicAllowed =
    environment.MAPS_PUBLIC_GEOCODING_ALLOWED?.trim().toLowerCase();
  const publicAllowed =
    configuredPublicAllowed == null
      ? environment.NODE_ENV !== "test"
      : configuredPublicAllowed !== "false";
  const userAgent =
    environment.NOMINATIM_USER_AGENT?.trim() || DEFAULT_NOMINATIM_USER_AGENT;

  let providerUrl: URL;
  try {
    providerUrl = new URL(baseUrl);
  } catch {
    return {
      baseUrl,
      mode: "disabled",
      providerHost: "invalid",
      publicAllowed,
      rateLimitMs: 0,
      userAgent,
    };
  }

  const isPublic = providerUrl.hostname.toLowerCase() === PUBLIC_NOMINATIM_HOST;
  return {
    baseUrl,
    mode: isPublic ? (publicAllowed ? "public" : "disabled") : "custom",
    providerHost: providerUrl.host,
    publicAllowed,
    rateLimitMs: isPublic ? PUBLIC_RATE_LIMIT_MS : 0,
    userAgent,
  };
}

export function mapsGeocodingStartupDiagnostics(): Omit<
  MapsGeocodingConfig,
  "baseUrl" | "userAgent"
> {
  const { mode, providerHost, publicAllowed, rateLimitMs } =
    resolveMapsGeocodingConfig();
  return { mode, providerHost, publicAllowed, rateLimitMs };
}
