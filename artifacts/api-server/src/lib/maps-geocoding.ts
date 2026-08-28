import { eq } from "drizzle-orm";
import { db, mapsGeocodeCacheTable } from "@workspace/db";

export type MapsLocation = { latitude: number | null; longitude: number | null; locationStatus: "resolved" | "not_found" | "error" };
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let nextPublicRequestAt = 0;
const pending = new Map<string, Promise<MapsLocation>>();

export function normalizeMapsAddress(address: string): string {
  return address.trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

function publicGeocodingAllowed(): boolean {
  return process.env.MAPS_PUBLIC_GEOCODING_ALLOWED === "true";
}

async function providerLookup(address: string): Promise<MapsLocation> {
  if (!publicGeocodingAllowed()) return { latitude: null, longitude: null, locationStatus: "error" };
  const wait = Math.max(0, nextPublicRequestAt - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  nextPublicRequestAt = Date.now() + 1_100;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const base = (process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
    const response = await fetch(`${base}/search?${new URLSearchParams({ q: address, format: "jsonv2", limit: "1" })}`, {
      headers: { "User-Agent": process.env.NOMINATIM_USER_AGENT || "MagazzinoSolidale/1.0 (+https://magazzino.angeliinmoto.it)", Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { latitude: null, longitude: null, locationStatus: "error" };
    const row = (await response.json() as Array<{ lat?: string; lon?: string }>)[0];
    const latitude = Number(row?.lat); const longitude = Number(row?.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude, locationStatus: "resolved" }
      : { latitude: null, longitude: null, locationStatus: "not_found" };
  } catch {
    return { latitude: null, longitude: null, locationStatus: "error" };
  } finally { clearTimeout(timeout); }
}

export async function geocodeMapsAddress(address: string): Promise<MapsLocation> {
  const normalizedAddress = normalizeMapsAddress(address);
  if (!normalizedAddress) return { latitude: null, longitude: null, locationStatus: "not_found" };
  const current = pending.get(normalizedAddress); if (current) return current;
  const task = (async () => {
    const [cached] = await db.select().from(mapsGeocodeCacheTable).where(eq(mapsGeocodeCacheTable.normalizedAddress, normalizedAddress)).limit(1);
    if (cached?.status === "resolved" && cached.latitude != null && cached.longitude != null) {
      return { latitude: Number(cached.latitude), longitude: Number(cached.longitude), locationStatus: "resolved" as const };
    }
    if (cached && cached.lastAttemptAt.getTime() > Date.now() - NEGATIVE_CACHE_TTL_MS) return { latitude: null, longitude: null, locationStatus: cached.status === "not_found" ? "not_found" as const : "error" as const };
    const location = await providerLookup(address);
    const values = { normalizedAddress, originalAddress: address.trim(), latitude: location.latitude?.toString() ?? null, longitude: location.longitude?.toString() ?? null, provider: "nominatim", status: location.locationStatus, lastAttemptAt: new Date(), updatedAt: new Date() };
    if (cached) await db.update(mapsGeocodeCacheTable).set(values).where(eq(mapsGeocodeCacheTable.id, cached.id));
    else await db.insert(mapsGeocodeCacheTable).values(values);
    return location;
  })();
  pending.set(normalizedAddress, task);
  try { return await task; } finally { pending.delete(normalizedAddress); }
}
