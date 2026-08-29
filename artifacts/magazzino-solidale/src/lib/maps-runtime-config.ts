export const DEFAULT_MAPS_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_MAPS_TILE_ATTRIBUTION = "© OpenStreetMap contributors";

const PLACEHOLDERS = ["{z}", "{x}", "{y}"] as const;
let invalidTileUrlReported = false;

function occurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

function allowsInsecureProtocol(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".test")
  );
}

export function isValidMapsTileUrl(value?: string | null): value is string {
  if (!value || value !== value.trim()) return false;
  if (/\s|[\[\]()]/u.test(value)) return false;
  if (
    PLACEHOLDERS.some((placeholder) => occurrences(value, placeholder) !== 1)
  ) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(
      value.replace("{z}", "6").replace("{x}", "33").replace("{y}", "24"),
    );
  } catch {
    return false;
  }

  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && allowsInsecureProtocol(parsed);
}

export function resolveMapsTileUrl(value?: string | null): string {
  return isValidMapsTileUrl(value) ? value : DEFAULT_MAPS_TILE_URL;
}

export function resolveMapsTileAttribution(value?: string | null): string {
  const candidate = value?.trim();
  if (
    !candidate ||
    candidate.length > 300 ||
    /[\u0000-\u001f<>]/u.test(candidate)
  ) {
    return DEFAULT_MAPS_TILE_ATTRIBUTION;
  }
  return candidate;
}

export function reportInvalidMapsTileUrl(value?: string | null): void {
  if (invalidTileUrlReported || value == null || isValidMapsTileUrl(value)) {
    return;
  }
  invalidTileUrlReported = true;
  console.warn(
    "Configurazione MAPS tile non valida; applicato il provider predefinito.",
  );
}
