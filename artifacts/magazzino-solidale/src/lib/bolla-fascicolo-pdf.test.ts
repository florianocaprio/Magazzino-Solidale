import { describe, expect, it, vi } from "vitest";
import type { BollaDettaglio } from "@workspace/api-client-react";
const saved = vi.hoisted(() => ({ pdf: "" }));
vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  return {
    ...actual,
    jsPDF: function (options: ConstructorParameters<typeof actual.jsPDF>[0]) {
      const doc = new actual.jsPDF(options);
      doc.save = (() => {
        saved.pdf = doc.output();
        return doc;
      }) as typeof doc.save;
      return doc;
    },
  };
});
import { generateBollaPdf, type BollaTemplate } from "./bolla-pdf";

describe("Fascicolo nella Bolla PDF", () => {
  it.each(["standard", "moderno", "minimal"] as BollaTemplate[])(
    "stampa il codice facoltativo del beneficiario nel modello %s",
    async (template) => {
      const bolla = {
        id: 1,
        numeroBolla: "PROVA-1",
        dataBolla: "2026-10-20",
        tipoDestinatario: "beneficiario",
        beneficiarioId: 2,
        beneficiarioNome: "Persona Sintetica",
        beneficiarioFascicolo: "MAN-001",
        magazzinoNome: "Deposito prova",
        stato: "consegnato",
        righe: [],
      } as unknown as BollaDettaglio;
      await generateBollaPdf({ bolla, template, associationLogoDataUrl: null });
      expect(saved.pdf).toContain("Fascicolo: MAN-001");
      await generateBollaPdf({
        bolla: { ...bolla, beneficiarioFascicolo: null },
        template,
        associationLogoDataUrl: null,
      });
      expect(saved.pdf).not.toContain("Fascicolo:");
      await generateBollaPdf({
        bolla: {
          ...bolla,
          tipoDestinatario: "ente",
          enteDestinatarioNome: "Ente prova",
        },
        template,
        associationLogoDataUrl: null,
      });
      expect(saved.pdf).not.toContain("Fascicolo:");
    },
  );
});
