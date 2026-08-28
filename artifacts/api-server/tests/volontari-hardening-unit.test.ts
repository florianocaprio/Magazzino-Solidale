/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  canonicalLedgerEventHash,
  verifyVolontarioLedgerChain,
} from "../src/lib/volontariLedger";
import {
  formatPermanentVolunteerIdentifier,
  validatePermanentIdentifierConfiguration,
} from "../src/lib/volontariMatricola";
import {
  volunteerScopeFingerprint,
  type VolunteerOwnerScope,
} from "../src/lib/volontariScope";

type LedgerRow = {
  id: number;
  progressivo: number;
  sezione: "PERMANENTE" | "TEMPORANEO";
  tipoEvento:
    | "REGISTRAZIONE"
    | "SOSPENSIONE_CESSAZIONE"
    | "RIATTIVAZIONE"
    | "GIORNATA_TEMPORANEA"
    | "CONVERSIONE_PERMANENTE"
    | "AGGIORNAMENTO_ANAGRAFICA"
    | "RETTIFICA";
  volontarioId: number;
  centroAscoltoId: number | null;
  dataEffettiva: string;
  snapshot: Record<string, unknown>;
  utenteId: number | null;
  eventoRettificatoId: number | null;
  hashPrecedente: string | null;
  hashEvento: string;
};

function event(input: Omit<LedgerRow, "hashEvento">): LedgerRow {
  return {
    ...input,
    hashEvento: canonicalLedgerEventHash(input),
  };
}

function executor(rows: LedgerRow[]) {
  return {
    select: () => ({
      from: () => ({
        orderBy: async () => rows,
      }),
    }),
  } as never;
}

describe("hardening Volontari — funzioni pure", () => {
  it("valida e formatta in modo deterministico la regola permanente", () => {
    const parsed = validatePermanentIdentifierConfiguration({
      prefissoAssociazione: "  ass ",
      includiCodiceArea: true,
      segmentoFisso: "v",
      separatore: "-",
      cifreProgressivo: 4,
      numeroIniziale: 10,
      ambitoProgressivo: "per_area",
    });
    expect(parsed).toMatchObject({
      prefissoAssociazione: "ASS",
      segmentoFisso: "V",
      ambitoProgressivo: "PER_AREA",
    });
    expect(
      formatPermanentVolunteerIdentifier(
        { id: 1, versione: 2, ...parsed },
        "RM",
        12,
      ),
    ).toBe("ASS-RM-V-0012");
    expect(() =>
      validatePermanentIdentifierConfiguration({
        cifreProgressivo: 1,
        numeroIniziale: 1,
      }),
    ).toThrow(/cifre/i);
  });

  it("calcola uno scope fingerprint stabile rispetto all'ordine dei Centri", () => {
    const base: Omit<VolunteerOwnerScope, "scopeFingerprint"> = {
      scopeTipo: "AREA",
      scopeCentroId: null,
      scopeAreaOperativaId: 7,
      scopeCentroIdsSnapshot: [9, 3, 5],
    };
    expect(volunteerScopeFingerprint(base)).toBe(
      volunteerScopeFingerprint({
        ...base,
        scopeCentroIdsSnapshot: [5, 9, 3],
      }),
    );
    expect(volunteerScopeFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hardening Volontari — verifica catena ledger", () => {
  const first = event({
    id: 10,
    progressivo: 1,
    sezione: "PERMANENTE",
    tipoEvento: "REGISTRAZIONE",
    volontarioId: 20,
    centroAscoltoId: 3,
    dataEffettiva: "2026-01-01",
    snapshot: { volontarioId: 20 },
    utenteId: null,
    eventoRettificatoId: null,
    hashPrecedente: null,
  });
  const correction = event({
    id: 11,
    progressivo: 2,
    sezione: "PERMANENTE",
    tipoEvento: "RETTIFICA",
    volontarioId: 20,
    centroAscoltoId: 3,
    dataEffettiva: "2026-01-02",
    snapshot: { datiEvento: { rettifiche: [] } },
    utenteId: null,
    eventoRettificatoId: first.id,
    hashPrecedente: first.hashEvento,
  });

  it("accetta continuità, hash e riferimento rettifica validi", async () => {
    await expect(
      verifyVolontarioLedgerChain(executor([first, correction])),
    ).resolves.toMatchObject({ valid: true, eventi: 2 });
  });

  it.each([
    {
      name: "progressivo mancante",
      rows: [{ ...first, progressivo: 2 }],
      reason: "PROGRESSIVO_NON_CONSECUTIVO",
    },
    {
      name: "hash precedente errato",
      rows: [{ ...first }, { ...correction, hashPrecedente: "x".repeat(64) }],
      reason: "HASH_PRECEDENTE_NON_VALIDO",
    },
    {
      name: "hash evento alterato",
      rows: [{ ...first, hashEvento: "f".repeat(64) }],
      reason: "HASH_EVENTO_NON_VALIDO",
    },
    {
      name: "rettifica senza evento esistente",
      rows: [{ ...first }, { ...correction, eventoRettificatoId: 999 }],
      reason: "RIFERIMENTO_RETTIFICA_NON_VALIDO",
    },
  ])("rileva $name", async ({ rows, reason }) => {
    await expect(
      verifyVolontarioLedgerChain(executor(rows as LedgerRow[])),
    ).resolves.toMatchObject({ valid: false, reason });
  });
});
