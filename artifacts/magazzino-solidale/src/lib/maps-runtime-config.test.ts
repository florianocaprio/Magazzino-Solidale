import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAPS_TILE_ATTRIBUTION,
  DEFAULT_MAPS_TILE_URL,
  reportInvalidMapsTileUrl,
  resolveMapsTileAttribution,
  resolveMapsTileUrl,
} from "./maps-runtime-config";

describe("runtime config MAPS", () => {
  it("usa una URL HTTPS valida", () => {
    const value = "https://tiles.example.test/{z}/{x}/{y}.png";
    expect(resolveMapsTileUrl(value)).toBe(value);
  });

  it.each([undefined, null, "", "   "])(
    "usa il default per un valore assente o vuoto: %s",
    (value) => {
      expect(resolveMapsTileUrl(value)).toBe(DEFAULT_MAPS_TILE_URL);
    },
  );

  it.each([
    "https://tiles.example.test/{z}/{x}/{y}.png/{x}/{y}.png",
    "https://tiles.example.test/{z}/{x}.png",
    "https://tiles.example.test/{z}/{x}/{y}/{y}.png",
  ])("rifiuta placeholder mancanti o duplicati: %s", (value) => {
    expect(resolveMapsTileUrl(value)).toBe(DEFAULT_MAPS_TILE_URL);
  });

  it.each([
    "[https://tiles.example.test/{z}/{x}/{y}.png]",
    "https://tiles.example.test/{z}/{x}/{y}.png (tiles)",
    "https://tiles.example.test/{z}/{x}/{y}.png\n",
  ])("rifiuta markdown o whitespace accidentale: %s", (value) => {
    expect(resolveMapsTileUrl(value)).toBe(DEFAULT_MAPS_TILE_URL);
  });

  it("accetta HTTP soltanto per localhost o domini test", () => {
    expect(resolveMapsTileUrl("http://localhost:8080/{z}/{x}/{y}.png")).toBe(
      "http://localhost:8080/{z}/{x}/{y}.png",
    );
    expect(
      resolveMapsTileUrl("http://tiles.example.test/{z}/{x}/{y}.png"),
    ).toBe("http://tiles.example.test/{z}/{x}/{y}.png");
    expect(resolveMapsTileUrl("http://tiles.example.com/{z}/{x}/{y}.png")).toBe(
      DEFAULT_MAPS_TILE_URL,
    );
  });

  it("valida l'attribuzione con un default testuale sicuro", () => {
    expect(resolveMapsTileAttribution("Example contributors")).toBe(
      "Example contributors",
    );
    expect(resolveMapsTileAttribution("")).toBe(DEFAULT_MAPS_TILE_ATTRIBUTION);
    expect(resolveMapsTileAttribution("<img onerror=alert(1)>")).toBe(
      DEFAULT_MAPS_TILE_ATTRIBUTION,
    );
  });

  it("registra una sola diagnostica sicura per una configurazione non valida", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    reportInvalidMapsTileUrl("https://tiles.invalid/{z}/{x}/{y}/{y}.png");
    reportInvalidMapsTileUrl("https://tiles.invalid/{z}/{x}/{y}/{y}.png");

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0].join(" ")).not.toContain("tiles.invalid");
  });
});
