import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapsMarker } from "@workspace/api-client-react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

import {
  GEOCODING_CONCURRENCY,
  GoogleOperationalMap,
  MAX_MAP_MARKERS,
  clearMapsGeocodeCacheForTests,
  normalizeMapsAddress,
} from "./google-operational-map";

const marker = (id: number, address: string): MapsMarker => ({
  id: `marker:${id}`,
  layer: "pacchi.consegne",
  entityType: "consegna",
  entityId: id,
  title: `Marker ${id}`,
  subtitle: null,
  status: "pianificata",
  address,
  date: "2026-08-22",
  actions: [],
});

function installGoogle(
  geocode: (request: { address: string }) => Promise<unknown>,
) {
  const map = { setCenter: vi.fn() };
  const addListener = vi.fn();
  const MapConstructor = vi.fn(function () {
    return map;
  });
  const MarkerConstructor = vi.fn(function () {
    return { addListener };
  });
  const GeocoderConstructor = vi.fn(function () {
    return { geocode };
  });
  window.google = {
    maps: {
      Map: MapConstructor,
      Marker: MarkerConstructor,
      Geocoder: GeocoderConstructor,
    } as unknown as NonNullable<typeof window.google>["maps"],
  };
  return { map, MapConstructor, MarkerConstructor };
}

const success = (lat = 41.9, lng = 12.5) =>
  Promise.resolve({
    results: [{ geometry: { location: { lat: () => lat, lng: () => lng } } }],
  });

describe("GoogleOperationalMap", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    clearMapsGeocodeCacheForTests();
    delete window.google;
    delete window.__mapsLoader;
    document.head
      .querySelectorAll('script[src*="maps.googleapis.com"]')
      .forEach((script) => script.remove());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.google;
    delete window.__mapsLoader;
    document.head
      .querySelectorAll('script[src*="maps.googleapis.com"]')
      .forEach((script) => script.remove());
  });

  it("normalizza e deduplica gli indirizzi mostrando anche i fallimenti", async () => {
    const geocode = vi.fn(({ address }: { address: string }) =>
      address.includes("Errore")
        ? Promise.reject(new Error("non localizzabile"))
        : success(),
    );
    const runtime = installGoogle(geocode);
    await act(async () => {
      root.render(
        <GoogleOperationalMap
          markers={[
            marker(1, " Via Roma  1 "),
            marker(2, "via roma 1"),
            marker(3, "Via Errore 2"),
          ]}
          apiKey="test"
          onMarkerSelect={vi.fn()}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(normalizeMapsAddress(" Via Roma  1 ")).toBe("via roma 1");
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(runtime.MarkerConstructor).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('"localized":2');
    expect(document.body.textContent).toContain('"failed":1');
  });

  it("riusa la cache di sessione dopo un rerender", async () => {
    const geocode = vi.fn(() => success());
    installGoogle(geocode);
    await act(async () => {
      root.render(
        <GoogleOperationalMap
          markers={[marker(1, "Via Cache 1")]}
          apiKey="test"
          onMarkerSelect={vi.fn()}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      root.render(
        <GoogleOperationalMap
          markers={[marker(2, "  via cache  1 ")]}
          apiKey="test"
          onMarkerSelect={vi.fn()}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("limita il geocoding, mostra il warning e usa concorrenza bounded", async () => {
    let active = 0;
    let maxActive = 0;
    const geocode = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return success();
    });
    installGoogle(geocode);
    const markers = Array.from({ length: MAX_MAP_MARKERS + 1 }, (_, index) =>
      marker(index + 1, `Via Concorrenza ${index}`),
    );
    await act(async () => {
      root.render(
        <GoogleOperationalMap
          markers={markers}
          apiKey="test"
          onMarkerSelect={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await vi.waitFor(
        () => expect(geocode).toHaveBeenCalledTimes(MAX_MAP_MARKERS),
        { timeout: 1_000 },
      );
    });

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(GEOCODING_CONCURRENCY);
    expect(document.body.textContent).toContain("maps.markerLimitWarning");
    expect(document.body.textContent).toContain('"notAttempted":1');
  });

  it("azzera la Promise rejected e consente il retry esplicito del loader", async () => {
    let appendedScript: HTMLScriptElement | null = null;
    const append = vi
      .spyOn(document.head, "appendChild")
      .mockImplementation((node) => {
        appendedScript = node as HTMLScriptElement;
        return node;
      });
    await act(async () => {
      root.render(
        <GoogleOperationalMap
          markers={[marker(1, "Via Retry 1")]}
          apiKey="test"
          onMarkerSelect={vi.fn()}
        />,
      );
    });
    const firstScript = appendedScript as HTMLScriptElement | null;
    if (!firstScript) throw new Error("Loader Google non inserito");
    await act(async () => {
      firstScript.onerror?.(new Event("error"));
      await Promise.resolve();
    });
    append.mockRestore();
    expect(window.__mapsLoader).toBeUndefined();
    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("maps.retryMap"),
    );
    expect(retry).toBeTruthy();

    const geocode = vi.fn(() => success());
    installGoogle(geocode);
    await act(async () => {
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(
      document.querySelector('[aria-label="Mappa operativa Google Maps"]'),
    ).toBeTruthy();
    expect(geocode).toHaveBeenCalledTimes(1);
  });
});
