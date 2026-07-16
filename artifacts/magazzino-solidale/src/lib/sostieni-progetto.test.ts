import { describe, expect, it, vi } from "vitest";
import { buildSupportMailto, sostieniProgettoConfig } from "./sostieni-progetto";

describe("mailto Sostieni il progetto", () => {
  it("genera protocollo, destinatario, oggetto e corpo codificati senza chiamate API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const subject = "Richiesta informazioni supporto annuale Magazzino Solidale";
    const body = "Buongiorno,\nOrganizzazione:\nReferente:\nRecapito:\n\nGrazie.";
    const href = buildSupportMailto(sostieniProgettoConfig.supportEmail, subject, body);

    expect(href).toBe(
      `mailto:supporto@angeliinmoto.it?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
