/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  reconcileFseLines,
  reconciliationMovementType,
  type ReconciliationExternalLine,
  type ReconciliationLocalLine,
} from "../src/lib/fseReconciliation";

const localDelivery: ReconciliationLocalLine = {
  movementId: 1,
  operationDistributionId: null,
  caricoMagazzinoRigaId: null,
  eventKey: "MOVIMENTO:1",
  lineKey: "MOVIMENTO:1",
  type: reconciliationMovementType("CONSEGNA_ENTE"),
  fund: "FSE_PLUS",
  productId: 100,
  lot: "LOT-1",
  date: "2026-09-19",
  pieces: "-4.000000",
  kgLt: null,
  channel: null,
  packs: null,
  meals: null,
  occasional: null,
  continuous: null,
};

const externalDistribution: ReconciliationExternalLine = {
  importRowId: 20,
  externalMovementId: 30,
  caricoMagazzinoRigaId: null,
  type: "DISTRIBUZIONE",
  fund: "FSE_PLUS",
  productId: 100,
  lot: "LOT-1",
  date: "2026-09-19",
  pieces: "-4.000000",
  kgLt: null,
  channel: null,
  packs: null,
  meals: null,
  occasional: null,
  continuous: null,
  modified: false,
};

describe("M4A — classificazione riconciliazione CONSEGNA_ENTE", () => {
  it("mantiene l'uscita Ente distinta dalla distribuzione e dalle rettifiche", () => {
    expect(reconciliationMovementType("CONSEGNA_ENTE")).toBe("CONSEGNA_ENTE");
    expect(reconciliationMovementType("DISTRIBUZIONE_FINALE")).toBe(
      "DISTRIBUZIONE",
    );
    expect(reconciliationMovementType("RETTIFICA_NEGATIVA")).toBe(
      "MODIFICA_GIACENZA",
    );

    const rows = reconcileFseLines([localDelivery], [externalDistribution]);

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipoRiga: "CONSEGNA_ENTE",
          status: "CONSEGNA_ENTE_NON_RISCONTRATA",
          blocking: true,
        }),
        expect.objectContaining({
          tipoRiga: "DISTRIBUZIONE",
          status: "SOLO_AGEA",
        }),
      ]),
    );
  });
});
