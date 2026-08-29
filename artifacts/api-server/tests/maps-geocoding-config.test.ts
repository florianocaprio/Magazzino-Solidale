/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { resolveMapsGeocodingConfig } from "../src/lib/maps-geocoding-config";

describe("configurazione geocoding MAPS", () => {
  it("abilita Nominatim pubblico per default con rate limit e User-Agent identificativo", () => {
    expect(resolveMapsGeocodingConfig({})).toEqual({
      baseUrl: "https://nominatim.openstreetmap.org",
      mode: "public",
      providerHost: "nominatim.openstreetmap.org",
      publicAllowed: true,
      rateLimitMs: 1_100,
      userAgent: "MagazzinoSolidale/2.1 (+https://magazzino.angeliinmoto.it)",
    });
  });

  it("rispetta sempre il false esplicito per il provider pubblico", () => {
    const config = resolveMapsGeocodingConfig({
      MAPS_PUBLIC_GEOCODING_ALLOWED: "false",
    });

    expect(config.mode).toBe("disabled");
    expect(config.publicAllowed).toBe(false);
  });

  it("non usa la rete pubblica nei test quando il flag non è esplicito", () => {
    const config = resolveMapsGeocodingConfig({ NODE_ENV: "test" });

    expect(config.mode).toBe("disabled");
    expect(config.publicAllowed).toBe(false);
  });

  it("consente un provider custom anche se il provider pubblico è disabilitato", () => {
    const config = resolveMapsGeocodingConfig({
      MAPS_PUBLIC_GEOCODING_ALLOWED: "false",
      NOMINATIM_BASE_URL: "https://nominatim.internal.example/geocoder/",
      NOMINATIM_USER_AGENT: "ClienteMaps/2.1",
    });

    expect(config).toMatchObject({
      baseUrl: "https://nominatim.internal.example/geocoder",
      mode: "custom",
      providerHost: "nominatim.internal.example",
      publicAllowed: false,
      rateLimitMs: 0,
      userAgent: "ClienteMaps/2.1",
    });
  });

  it("non classifica come pubblico un hostname che contiene soltanto il nome ufficiale", () => {
    const config = resolveMapsGeocodingConfig({
      MAPS_PUBLIC_GEOCODING_ALLOWED: "false",
      NOMINATIM_BASE_URL: "https://nominatim.openstreetmap.org.example.test",
    });

    expect(config.mode).toBe("custom");
  });

  it("disabilita una base URL non valida senza ripiegare sul provider pubblico", () => {
    const config = resolveMapsGeocodingConfig({
      NOMINATIM_BASE_URL: "not a url",
    });

    expect(config).toMatchObject({ mode: "disabled", providerHost: "invalid" });
  });
});
