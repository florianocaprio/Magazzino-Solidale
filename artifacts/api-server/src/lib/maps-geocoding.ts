import { inArray } from "drizzle-orm";
import { db, mapsGeocodeCacheTable } from "@workspace/db";
import { resolveMapsGeocodingConfig } from "./maps-geocoding-config";

export type MapsLocationStatus = "resolved" | "pending" | "not_found" | "error";
export type MapsLocation = {
  latitude: number | null;
  longitude: number | null;
  locationStatus: MapsLocationStatus;
};

type Address = { normalizedAddress: string; originalAddress: string };
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const queue = new Map<string, Address>();

let workerRunning = false;
let nextPublicRequestAt = 0;

export function normalizeMapsAddress(address: string): string {
  return address.trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

async function lookup(address: string): Promise<MapsLocation> {
  const config = resolveMapsGeocodingConfig();
  if (config.mode === "disabled") {
    return { latitude: null, longitude: null, locationStatus: "error" };
  }

  if (config.mode === "public") {
    const wait = Math.max(0, nextPublicRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextPublicRequestAt = Date.now() + config.rateLimitMs;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${config.baseUrl}/search?${new URLSearchParams({
        q: address,
        format: "jsonv2",
        limit: "1",
      })}`,
      {
        headers: {
          "User-Agent": config.userAgent,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return { latitude: null, longitude: null, locationStatus: "error" };
    }

    const row = (
      (await response.json()) as Array<{ lat?: string; lon?: string }>
    )[0];
    const latitude = Number(row?.lat);
    const longitude = Number(row?.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude, locationStatus: "resolved" }
      : { latitude: null, longitude: null, locationStatus: "not_found" };
  } catch {
    return { latitude: null, longitude: null, locationStatus: "error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function processQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.size) {
      const [key, address] = queue.entries().next().value as [string, Address];
      queue.delete(key);
      const result = await lookup(address.originalAddress);
      const values = {
        ...address,
        latitude: result.latitude?.toString() ?? null,
        longitude: result.longitude?.toString() ?? null,
        provider: "nominatim",
        status: result.locationStatus,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(mapsGeocodeCacheTable).values(values).onConflictDoUpdate({
        target: mapsGeocodeCacheTable.normalizedAddress,
        set: values,
      });
    }
  } finally {
    workerRunning = false;
  }
}

export function queueMapsGeocoding(addresses: string[]): void {
  for (const originalAddress of addresses) {
    const normalizedAddress = normalizeMapsAddress(originalAddress);
    if (normalizedAddress) {
      queue.set(normalizedAddress, {
        normalizedAddress,
        originalAddress: originalAddress.trim(),
      });
    }
  }
  void processQueue();
}

export async function getCachedMapsLocations(
  addresses: string[],
): Promise<MapsLocation[]> {
  return enrichMapsMarkersFromCache(
    addresses.map((address) => ({ address })),
  ).then((markers) =>
    markers.map(({ latitude, longitude, locationStatus }) => ({
      latitude,
      longitude,
      locationStatus,
    })),
  );
}

export async function enrichMapsMarkersFromCache<T extends { address: string }>(
  markers: T[],
): Promise<Array<T & MapsLocation>> {
  const unique = [
    ...new Set(
      markers
        .map((marker) => normalizeMapsAddress(marker.address))
        .filter(Boolean),
    ),
  ];
  if (!unique.length) {
    return markers.map((marker) => ({
      ...marker,
      latitude: null,
      longitude: null,
      locationStatus: "not_found" as const,
    }));
  }

  const cached = await db
    .select()
    .from(mapsGeocodeCacheTable)
    .where(inArray(mapsGeocodeCacheTable.normalizedAddress, unique));
  const byAddress = new Map(cached.map((row) => [row.normalizedAddress, row]));
  const misses: string[] = [];
  const result = markers.map((marker) => {
    const row = byAddress.get(normalizeMapsAddress(marker.address));
    if (
      row?.status === "resolved" &&
      row.latitude != null &&
      row.longitude != null
    ) {
      return {
        ...marker,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        locationStatus: "resolved" as const,
      };
    }
    if (
      row &&
      row.lastAttemptAt.getTime() > Date.now() - NEGATIVE_CACHE_TTL_MS
    ) {
      return {
        ...marker,
        latitude: null,
        longitude: null,
        locationStatus:
          row.status === "not_found"
            ? ("not_found" as const)
            : ("error" as const),
      };
    }
    misses.push(marker.address);
    return {
      ...marker,
      latitude: null,
      longitude: null,
      locationStatus: "pending" as const,
    };
  });
  queueMapsGeocoding(misses);
  return result;
}

export async function geocodeMapsAddress(
  address: string,
): Promise<MapsLocation> {
  queueMapsGeocoding([address]);
  return { latitude: null, longitude: null, locationStatus: "pending" };
}
