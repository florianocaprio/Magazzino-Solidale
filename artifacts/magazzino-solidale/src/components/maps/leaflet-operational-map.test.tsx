import React, { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MapsMarker } from "@workspace/api-client-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (...args: unknown[]) => void;

const leafletState = vi.hoisted(() => ({
  maps: [] as Array<Record<string, unknown>>,
  groups: [] as Array<Record<string, unknown>>,
  tileLayers: [] as Array<Record<string, unknown>>,
  markers: [] as Array<Record<string, unknown>>,
}));

vi.mock("leaflet", () => {
  const map = vi.fn(
    (container: HTMLElement, options: Record<string, unknown>) => {
      const instance: Record<string, unknown> = {
        container,
        options,
        setView: vi.fn(() => instance),
        fitBounds: vi.fn(() => instance),
        invalidateSize: vi.fn(() => instance),
        removeLayer: vi.fn(() => instance),
        remove: vi.fn(),
      };
      leafletState.maps.push(instance);
      return instance;
    },
  );

  const layerGroup = vi.fn(() => {
    const instance: Record<string, unknown> = {
      addTo: vi.fn(() => instance),
      clearLayers: vi.fn(),
    };
    leafletState.groups.push(instance);
    return instance;
  });

  const tileLayer = vi.fn((url: string, options: Record<string, unknown>) => {
    const handlers: Record<string, EventHandler> = {};
    const instance: Record<string, unknown> = {
      url,
      options,
      handlers,
      on: vi.fn((events: Record<string, EventHandler>) => {
        Object.assign(handlers, events);
        return instance;
      }),
      off: vi.fn((events: Record<string, EventHandler>) => {
        for (const event of Object.keys(events)) delete handlers[event];
        return instance;
      }),
      addTo: vi.fn(() => instance),
      remove: vi.fn(() => instance),
      emit: (event: string) => handlers[event]?.(),
    };
    leafletState.tileLayers.push(instance);
    return instance;
  });

  const marker = vi.fn((point: unknown, options: Record<string, unknown>) => {
    const handlers: Record<string, EventHandler> = {};
    const instance: Record<string, unknown> = {
      point,
      options,
      handlers,
      bindTooltip: vi.fn(() => instance),
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers[event] = handler;
        return instance;
      }),
      off: vi.fn((event: string) => {
        delete handlers[event];
        return instance;
      }),
      addTo: vi.fn(() => instance),
      openTooltip: vi.fn(() => instance),
      emit: (event: string) => handlers[event]?.(),
    };
    leafletState.markers.push(instance);
    return instance;
  });

  return {
    default: {
      map,
      layerGroup,
      tileLayer,
      marker,
      divIcon: vi.fn((options: Record<string, unknown>) => ({ options })),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { LeafletOperationalMap } from "./leaflet-operational-map";

const baseMarker: MapsMarker & {
  latitude: number;
  longitude: number;
  locationStatus: "resolved";
} = {
  id: "pacchi.consegna:1",
  layer: "pacchi.consegne",
  entityType: "consegna",
  entityId: 1,
  title: "Consegna TEST-1",
  subtitle: null,
  status: "pianificata",
  address: "Via Test 1",
  date: "2026-08-29",
  actions: ["open", "route"],
  latitude: 41.9,
  longitude: 12.5,
  locationStatus: "resolved",
};

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }
}

describe("LeafletOperationalMap", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
      window.clearTimeout(handle),
    );
    leafletState.maps.length = 0;
    leafletState.groups.length = 0;
    leafletState.tileLayers.length = 0;
    leafletState.markers.length = 0;
    MockResizeObserver.instances.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("mantiene marker e mappa durante errore tile e ricrea soltanto il TileLayer al retry", async () => {
    const onUnavailable = vi.fn();
    const consoleWarning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () =>
      root.render(
        <LeafletOperationalMap
          markers={[baseMarker]}
          onMarkerSelect={vi.fn()}
          onUnavailable={onUnavailable}
          tileUrl="https://tiles.example.test/{z}/{x}/{y}.png"
          tileAttribution="Example contributors"
        />,
      ),
    );

    expect(leafletState.maps).toHaveLength(1);
    expect(leafletState.groups).toHaveLength(1);
    expect(leafletState.tileLayers).toHaveLength(1);
    expect(leafletState.markers).toHaveLength(1);
    expect(leafletState.maps[0].options).toMatchObject({
      touchZoom: true,
      dragging: true,
      scrollWheelZoom: false,
    });
    expect(leafletState.tileLayers[0]).toMatchObject({
      url: "https://tiles.example.test/{z}/{x}/{y}.png",
      options: { attribution: "Example contributors" },
    });
    expect(
      (
        leafletState.markers[0].options as {
          icon: { options: { iconSize: number[] } };
        }
      ).icon.options.iconSize,
    ).toEqual([44, 44]);

    await act(async () => {
      (leafletState.tileLayers[0].emit as (event: string) => void)("tileload");
    });
    expect(
      document.querySelector('[data-tile-state="available"]'),
    ).toBeTruthy();

    await act(async () => {
      const emit = leafletState.tileLayers[0].emit as (event: string) => void;
      emit("tileerror");
      emit("tileerror");
      emit("tileerror");
      emit("tileerror");
    });
    expect(
      document.querySelector('[data-testid="maps-tile-error"]'),
    ).toBeTruthy();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(consoleWarning).toHaveBeenCalledTimes(1);
    expect(leafletState.markers).toHaveLength(1);

    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "maps.retryCartography",
    );
    await act(async () => retry?.click());

    expect(leafletState.maps).toHaveLength(1);
    expect(leafletState.groups).toHaveLength(1);
    expect(leafletState.tileLayers).toHaveLength(2);
    expect(leafletState.markers).toHaveLength(1);

    await act(async () => {
      (leafletState.tileLayers[1].emit as (event: string) => void)("tileerror");
      (leafletState.tileLayers[1].emit as (event: string) => void)("load");
    });
    expect(
      document.querySelector('[data-testid="maps-tile-error"]'),
    ).toBeTruthy();

    await act(async () => {
      (leafletState.tileLayers[1].emit as (event: string) => void)("tileload");
    });
    expect(
      document.querySelector('[data-testid="maps-tile-error"]'),
    ).toBeNull();
  });

  it("aggiorna marker e selezione senza ricreare la mappa", async () => {
    const onMarkerSelect = vi.fn();
    await act(async () =>
      root.render(
        <LeafletOperationalMap
          markers={[baseMarker]}
          onMarkerSelect={onMarkerSelect}
        />,
      ),
    );
    const secondMarker = {
      ...baseMarker,
      id: "pacchi.consegna:2",
      entityId: 2,
      title: "Consegna TEST-2",
      latitude: 42.1,
      longitude: 12.7,
    };

    await act(async () =>
      root.render(
        <LeafletOperationalMap
          markers={[baseMarker, secondMarker]}
          selectedMarkerId={secondMarker.id}
          onMarkerSelect={onMarkerSelect}
        />,
      ),
    );

    expect(leafletState.maps).toHaveLength(1);
    expect(leafletState.tileLayers).toHaveLength(1);
    expect(leafletState.markers).toHaveLength(3);
    expect(leafletState.maps[0].setView).toHaveBeenCalledWith(
      [42.1, 12.7],
      16,
      { animate: false },
    );

    await act(async () => {
      (leafletState.markers.at(-1)?.emit as (event: string) => void)("click");
    });
    expect(onMarkerSelect).toHaveBeenCalledWith(secondMarker);
  });

  it("segnala il timeout tile una sola volta senza rimuovere i marker", async () => {
    const onUnavailable = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await act(async () =>
      root.render(
        <LeafletOperationalMap
          markers={[baseMarker]}
          onMarkerSelect={vi.fn()}
          onUnavailable={onUnavailable}
        />,
      ),
    );

    await act(async () => vi.advanceTimersByTime(8_000));

    expect(
      document.querySelector('[data-testid="maps-tile-error"]'),
    ).toBeTruthy();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(leafletState.markers).toHaveLength(1);
  });

  it("invalida la dimensione e pulisce observer, layer, timer e mappa", async () => {
    await act(async () =>
      root.render(
        <LeafletOperationalMap
          markers={[baseMarker]}
          onMarkerSelect={vi.fn()}
        />,
      ),
    );
    const observer = MockResizeObserver.instances.at(-1)!;
    const map = leafletState.maps[0];
    const tileLayer = leafletState.tileLayers[0];

    await act(async () => {
      observer.callback([], observer as unknown as ResizeObserver);
      vi.advanceTimersByTime(1);
    });
    expect(map.invalidateSize).toHaveBeenCalled();

    await act(async () => root.unmount());
    mounted = false;
    expect(observer.disconnect).toHaveBeenCalled();
    expect(tileLayer.off).toHaveBeenCalled();
    expect(tileLayer.remove).toHaveBeenCalled();
    expect(map.remove).toHaveBeenCalled();
  });

  it("in Strict Mode rimuove l'istanza di prova prima di mantenere quella attiva", async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <LeafletOperationalMap
            markers={[baseMarker]}
            onMarkerSelect={vi.fn()}
          />
        </StrictMode>,
      ),
    );

    expect(leafletState.maps).toHaveLength(2);
    expect(leafletState.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(leafletState.maps[1].remove).not.toHaveBeenCalled();
  });
});
