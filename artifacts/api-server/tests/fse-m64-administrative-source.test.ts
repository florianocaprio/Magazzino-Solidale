/* @vitest-environment node */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import request from "supertest";
import {
  db,
  pool,
  fseSourceRegistriesTable,
  fseImportSessionsTable,
  fseImportRowsTable,
  fseAdministrativeVersionsTable,
  fseAdministrativeObservationsTable,
  fseReconciliationRunsTable,
  lottiLogiciTable,
  utentiTable,
  ruoliTable,
  lottiTable,
  importazioniAgeaTable,
  importazioniAgeaRigheTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  acquireFseFile,
  mapFseProduct,
  addFseRowsToPractice,
  reviseFseImportRow,
} from "../src/lib/fsePracticeImportService";
import {
  calculateFseReconciliation,
  recalculateFseReconciliation,
} from "../src/lib/fseReconciliation";
import fseRouter from "../src/routes/fse";
import caricoRouter from "../src/routes/carico-pratiche";
import { creaScaricoInventariale } from "../src/lib/scaricoInventory";
import { InventoryDecimal } from "../src/lib/inventoryDecimal";
import {
  createAreaOperativa,
  createMagazzino,
  createProdotto,
  createRuolo,
  createUtente,
  createLotto,
  newScope,
  makeScopedApp,
} from "./scope-helpers";

const scope = newScope();
let area: number,
  warehouse: number,
  source: number,
  logical: number,
  actor: number,
  role: number,
  product: number;
const permissions = [
  "magazzino.fse.view",
  "magazzino.fse.reconcile",
  "magazzino.fse.reconcile.manage",
  "magazzino.agea.import",
];
const audit = () => ({
  actor: {
    actorType: "user" as const,
    actorUserId: actor,
    actorCodeSnapshot: "M64-ADMIN-TEST",
    initiatedByUserId: null,
    initiatedByCodeSnapshot: null,
  },
  correlationId: randomUUID(),
});
const api = () =>
  makeScopedApp(fseRouter, {
    id: actor,
    isAdmin: true,
    aree: ["magazzino"],
    permessi: permissions,
    areaOperativaId: area,
    centroAscoltoId: null,
  });
function fixture(document = randomUUID(), rows = 1, reference = "17/09/2026") {
  const headers = [
    "Fondo",
    "Prodotto",
    `Giacenza al ${reference} Pezzi`,
    `Giacenza al ${reference} KgLt`,
    "Numero documento",
    "Data documento",
    "Data carico magazzino",
    "Lotto",
    "Mittente / destinatario",
    "Carico / scarico",
    "Carico / scarico pezzi",
    "Giacenza pezzi alla movimentazione",
    "Giacenza alla movimentazione",
    "Note",
    "Attività",
    "Pacchi",
    "Pasti",
    "Indigenti saltuari",
    "Indigenti continuativi",
  ];
  const row = [
    "FSE+",
    "Prodotto M64 sintetico",
    10,
    null,
    document,
    "17/09/2026",
    "17/09/2026",
    "LOT-M64",
    "OpC sintetico",
    null,
    10,
    10,
    null,
    "PRIVATE-NOTE-SENTINEL",
    null,
    null,
    null,
    null,
    null,
  ];
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    w,
    XLSX.utils.aoa_to_sheet([
      headers,
      ...Array.from({ length: rows }, (_, i) =>
        row.map((v, col) => (col === 4 ? `${document}-${i}` : v)),
      ),
    ]),
    "Registro",
  );
  return Buffer.from(XLSX.write(w, { type: "buffer", bookType: "xlsx" }));
}
async function acquire(rows = 1, buffer = fixture(randomUUID(), rows)) {
  const result = await db.transaction((tx) =>
    acquireFseFile(tx, {
      buffer,
      nomeFile: "registro-sintetico.xlsx",
      profile: "REGISTRO",
      sourceRegistryId: source,
      areaOperativaId: area,
      magazzinoId: warehouse,
      lottoLogicoId: logical,
      modalita: "NUOVI_CARICHI",
      actorId: actor,
      audit: audit(),
    }),
  );
  const [session] = await db
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, result.sessionId));
  return session;
}
function command(session: typeof fseImportSessionsTable.$inferSelect) {
  return {
    sourceType: "FSE_M3B" as const,
    sessionId: session.id,
    sessionVersion: session.versione,
    magazzinoId: warehouse,
    dataRiferimento: "2026-09-17",
    creatoDa: actor,
    audit: audit(),
    commandKey: randomUUID(),
  };
}
beforeAll(async () => {
  area = await createAreaOperativa(scope);
  warehouse = await createMagazzino(scope, null, { areaOperativaId: area });
  role = await createRuolo(scope, { isAdmin: true });
  await db
    .update(ruoliTable)
    .set({ aree: ["magazzino"], permessi: permissions })
    .where(eq(ruoliTable.id, role));
  actor = await createUtente(scope, { ruoloId: role });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: area })
    .where(eq(utentiTable.id, actor));
  product = await createProdotto(scope, { unitaMisura: "pz" });
  const [lot] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: area,
      codice: `M64-${randomUUID()}`,
      descrizione: "Raccolta sintetica M64",
      creatoDa: actor,
    })
    .returning();
  logical = lot.id;
  const [registry] = await db
    .insert(fseSourceRegistriesTable)
    .values({
      codice: `M64-${randomUUID()}`,
      descrizione: "Fonte sintetica M64",
      areaOperativaId: area,
      creatoDa: actor,
    })
    .returning();
  source = registry.id;
});
afterAll(async () => {
  await pool.end();
});

describe("D64-01 — actual M3B ingestion and immutable administrative source", () => {
  it.each(["AGEA_LEGACY", "FSE_M3B"] as const)(
    "D18: %s cancellation preserves frozen evidence and inventory; stale replay conflicts",
    async (sourceType) => {
      const result = await lifecycleReconciliation(sourceType);
      const id = result.reconciliation.id;
      const before = await lifecycleSnapshot(id);
      const response = await request(api())
        .post(`/fse/riconciliazioni/${id}/annulla`)
        .send({ versione: 1 });
      expect(response.status, response.text).toBe(200);
      expect(response.body).toMatchObject({
        stato: "ANNULLATA",
        versione: 2,
        annullatoDa: actor,
      });
      const replay = await request(api())
        .post(`/fse/riconciliazioni/${id}/annulla`)
        .send({ versione: 1 });
      expect(replay.status).toBe(409);
      await expect(
        recalculateFseReconciliation({
          id,
          versione: 2,
          actorId: actor,
          audit: audit(),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await lifecycleSnapshot(id)).toEqual(before);
      const events = await pool.query(
        "SELECT azione, actor_user_id FROM audit_eventi WHERE entita_tipo='riconciliazione_fse' AND entita_id=$1 AND azione='FSE_RICONCILIAZIONE_ANNULLATA'",
        [String(id)],
      );
      expect(events.rows).toEqual([
        { azione: "FSE_RICONCILIAZIONE_ANNULLATA", actor_user_id: actor },
      ]);
    },
  );
  it.each(["AGEA_LEGACY", "FSE_M3B"] as const)(
    "D18/D19: %s acceptance stays non-exact and closing preserves rows and runs after a new upload",
    async (sourceType) => {
      const result = await lifecycleReconciliation(sourceType);
      const id = result.reconciliation.id;
      expect(result.rows.length).toBeGreaterThan(0);
      const listed = await request(api()).get(
        `/fse/riconciliazioni/${id}/righe`,
      );
      expect(listed.status, listed.text).toBe(200);
      const row = listed.body.rows.find(
        (r: {
          importazioneAgeaRigaId: number | null;
          observationId: number | null;
        }) => r.importazioneAgeaRigaId != null || r.observationId != null,
      );
      expect(row).toBeDefined();
      const accepted = await request(api())
        .patch(`/fse/riconciliazioni/${id}/righe/${row.id}`)
        .send({
          versione: 1,
          azione: "ACCETTA_SCOSTAMENTO",
          motivazione:
            "Scostamento esterno intenzionalmente accettato nella fixture",
        });
      expect(accepted.status, accepted.text).toBe(200);
      expect(accepted.body).toMatchObject({ exact: false, blocking: false });
      const before = await lifecycleSnapshot(id);
      const closed = await request(api())
        .post(`/fse/riconciliazioni/${id}/chiudi`)
        .send({
          versione: 2,
          conScostamenti: true,
          motivazione: "Chiusura con scostamento documentato",
        });
      expect(closed.status, closed.text).toBe(200);
      expect(closed.body).toMatchObject({
        stato: "CHIUSA_CON_SCOSTAMENTI",
        versione: 3,
        chiusoDa: actor,
      });
      await acquire();
      await expect(
        recalculateFseReconciliation({
          id,
          versione: 3,
          actorId: actor,
          audit: audit(),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await lifecycleSnapshot(id)).toEqual(before);
      const events = await pool.query(
        "SELECT azione, actor_user_id FROM audit_eventi WHERE entita_tipo='riconciliazione_fse' AND entita_id=$1 AND azione IN ('FSE_RICONCILIAZIONE_RISOLTA','FSE_RICONCILIAZIONE_CHIUSA') ORDER BY id",
        [String(id)],
      );
      expect(events.rows).toEqual([
        { azione: "FSE_RICONCILIAZIONE_RISOLTA", actor_user_id: actor },
        { azione: "FSE_RICONCILIAZIONE_CHIUSA", actor_user_id: actor },
      ]);
    },
  );
  it("D02/D07/D14: unregistered source visible without claims or inventory writes", async () => {
    const session = await acquire();
    const before = await pool.query(
      "SELECT (SELECT count(*) FROM movimenti WHERE magazzino_id=$1)::int stock,(SELECT count(*) FROM fse_movement_claims WHERE source_registry_id=$2)::int claims",
      [warehouse, source],
    );
    const result = await calculateFseReconciliation(command(session));
    expect(result.reconciliation.sourceType).toBe("FSE_M3B");
    expect(result.reconciliation.importazioneAgeaId).toBeNull();
    const observations = await db
      .select()
      .from(fseAdministrativeObservationsTable)
      .where(
        eq(
          fseAdministrativeObservationsTable.versionId,
          result.reconciliation.administrativeVersionId!,
        ),
      );
    expect(observations).toHaveLength(1);
    expect(observations[0].rowId).toBeGreaterThan(0);
    expect(JSON.stringify(observations)).not.toContain("PRIVATE-NOTE-SENTINEL");
    expect(
      result.rows.some(
        (r) => r.observationId === observations[0].id && r.movimentoId == null,
      ),
    ).toBe(true);
    expect(
      await pool
        .query(
          "SELECT (SELECT count(*) FROM movimenti WHERE magazzino_id=$1)::int stock,(SELECT count(*) FROM fse_movement_claims WHERE source_registry_id=$2)::int claims",
          [warehouse, source],
        )
        .then((r) => r.rows),
    ).toEqual(before.rows);
  });
  it("D05/D19: later mapping does not change the frozen source; explicit recalculation appends a run", async () => {
    const session = await acquire();
    const result = await calculateFseReconciliation(command(session));
    const before = await db
      .select()
      .from(fseAdministrativeVersionsTable)
      .where(
        eq(
          fseAdministrativeVersionsTable.id,
          result.reconciliation.administrativeVersionId!,
        ),
      );
    await db.transaction((tx) =>
      mapFseProduct(tx, {
        sessionId: session.id,
        version: session.versione,
        externalDescription: "Prodotto M64 sintetico",
        productId: product,
        actorId: actor,
        reason: "Mappatura sintetica",
        acceptDateFallback: false,
        audit: audit(),
      }),
    );
    const [current] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, session.id));
    const next = await recalculateFseReconciliation({
      id: result.reconciliation.id,
      versione: result.reconciliation.versione,
      sessionVersion: current.versione,
      actorId: actor,
      audit: audit(),
    });
    expect(next.reconciliation.administrativeVersionId).not.toBe(
      result.reconciliation.administrativeVersionId,
    );
    expect(
      await db
        .select()
        .from(fseAdministrativeVersionsTable)
        .where(
          eq(
            fseAdministrativeVersionsTable.id,
            result.reconciliation.administrativeVersionId!,
          ),
        ),
    ).toEqual(before);
    const runs = await db
      .select()
      .from(fseReconciliationRunsTable)
      .where(
        eq(
          fseReconciliationRunsTable.reconciliationId,
          result.reconciliation.id,
        ),
      );
    expect(runs).toHaveLength(2);
  });
  it("D02/D07/D08: M3B → M3A real partial registration freezes only actual loaded portions", async () => {
    const session = await acquire(2);
    const rows = await db
      .select()
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.sessioneId, session.id));
    const attached = await db.transaction((tx) =>
      addFseRowsToPractice(tx, {
        sessionId: session.id,
        version: session.versione,
        rowIds: rows.map((r) => r.id),
        idempotencyKey: randomUUID(),
        historicalCoverageConfirmed: false,
        actorId: actor,
        audit: audit(),
      }),
    );
    const app = makeScopedApp(caricoRouter, {
      id: actor,
      isAdmin: true,
      areaOperativaId: area,
      centroAscoltoId: null,
      aree: ["magazzino"],
      permessi: ["magazzino.stock.receive"],
    });
    const practice = await request(app).get(
      `/carico-pratiche/${attached.practiceId}`,
    );
    expect(practice.status, practice.text).toBe(200);
    const registered = await request(app)
      .post(`/carico-pratiche/${attached.practiceId}/registra`)
      .send({
        versione: practice.body.versione,
        rigaIds: [practice.body.righe[0].id],
        idempotencyKey: randomUUID(),
      });
    expect(registered.status, registered.text).toBe(201);
    const [current] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, session.id));
    const reconciliation = await calculateFseReconciliation(command(current));
    const lineage = await pool.query(
      "SELECT al.claim_state,al.load_row_id,al.pieces FROM fse_administrative_lineage al JOIN fse_administrative_observations o ON o.id=al.observation_id WHERE o.version_id=$1 ORDER BY al.id",
      [reconciliation.reconciliation.administrativeVersionId],
    );
    expect(lineage.rows).toHaveLength(2);
    expect(lineage.rows.filter((r) => r.load_row_id != null)).toHaveLength(1);
    expect(lineage.rows.find((r) => r.load_row_id != null)).toMatchObject({
      claim_state: "REGISTRATA",
      pieces: "10.00",
    });
    expect(lineage.rows.find((r) => r.load_row_id == null)).toMatchObject({
      claim_state: "RISERVATA",
      pieces: null,
    });
    expect(
      reconciliation.rows.filter((r) => r.observationId != null),
    ).toHaveLength(2);
    const loaded = await pool.query(
      "SELECT count(*)::int n, sum(m.quantita)::text q FROM movimenti m JOIN carico_integrazione_righe ir ON ir.carico_magazzino_riga_id=m.carico_magazzino_riga_id JOIN carico_integrazioni i ON i.id=ir.carico_integrazione_id WHERE i.carico_pratica_id=$1",
      [attached.practiceId],
    );
    expect(loaded.rows).toEqual([{ n: 1, q: "10.000000" }]);
    const h = reconciliation.reconciliation.id;
    const pair = (
      await pool.query(
        "SELECT * FROM riconciliazioni_fse_righe WHERE riconciliazione_id=$1 AND movimento_id IS NOT NULL AND observation_id IS NOT NULL",
        [h],
      )
    ).rows[0];
    expect(
      pair,
      "actual registered M3A row must match the frozen observation",
    ).toBeDefined();
    expect(pair.quality_codes_json).not.toContain("CORREZIONE_INTENZIONALE");
    let version = 1;
    const resolve = async (action: string, extra = {}) => {
      const response = await request(api())
        .patch(`/fse/riconciliazioni/${h}/righe/${pair.id}`)
        .send({
          versione: version,
          azione: action,
          motivazione: "Verifica lifecycle M3B",
          ...extra,
        });
      expect(response.status, response.text).toBe(200);
      version++;
      return response.body;
    };
    await resolve("DISABBINA");
    const joined = await resolve("ABBINA", {
      movimentoId: pair.movimento_id,
      observationId: pair.observation_id,
    });
    expect(joined.observationId).toBe(pair.observation_id);
    const accepted = await resolve("ACCETTA_SCOSTAMENTO");
    expect(accepted.exact).toBe(false);
    expect(accepted.blocking).toBe(false);
    const reopened = await resolve("RIAPRI");
    expect(reopened.exact).toBe(pair.exact);
    expect(reopened.status).toBe(pair.status);
    const closed = await request(api())
      .post(`/fse/riconciliazioni/${h}/chiudi`)
      .send({
        versione: version,
        conScostamenti: true,
        motivazione: "Scostamenti documentati nella fixture",
      });
    expect(closed.status, closed.text).toBe(200);
    await expect(
      recalculateFseReconciliation({
        id: h,
        versione: version + 1,
        sessionVersion: current.versione,
        actorId: actor,
        audit: audit(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n,sum(m.quantita)::text q FROM movimenti m JOIN carico_integrazione_righe ir ON ir.carico_magazzino_riga_id=m.carico_magazzino_riga_id JOIN carico_integrazioni i ON i.id=ir.carico_integrazione_id WHERE i.carico_pratica_id=$1",
          [attached.practiceId],
        )
      ).rows,
    ).toEqual(loaded.rows);
  });
  it("D09: external distribution without a load claim matches a real inventory distribution", async () => {
    const workbook = XLSX.read(fixture(), { type: "buffer" });
    const contents = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets.Registro,
      { header: 1, defval: null },
    );
    const external = contents[1];
    external[8] = "Distribuzione indigenti";
    external[10] = -2;
    external[11] = 8;
    external[14] = "PACCHI";
    external[15] = 1;
    external[16] = 0;
    external[17] = 1;
    external[18] = 0;
    workbook.Sheets.Registro = XLSX.utils.aoa_to_sheet(contents);
    const session = await acquire(
      1,
      Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
    );
    await db.transaction((tx) =>
      mapFseProduct(tx, {
        sessionId: session.id,
        version: session.versione,
        externalDescription: "Prodotto M64 sintetico",
        productId: product,
        actorId: actor,
        reason: "Mapping distribuzione esterna",
        acceptDateFallback: false,
        audit: audit(),
      }),
    );
    const [current] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, session.id));
    const lot = await createLotto(scope, {
      prodottoId: product,
      magazzinoId: warehouse,
      quantita: 20,
      fsePlus: true,
    });
    await db
      .update(lottiTable)
      .set({ codiceLotto: "LOT-M64" })
      .where(eq(lottiTable.id, lot));
    const scarico = await db.transaction((tx) =>
      creaScaricoInventariale(tx, {
        codice: `D64-${randomUUID().slice(0, 20)}`,
        magazzinoId: warehouse,
        centroAscoltoId: null,
        dataScarico: "2026-09-17",
        causale: "altro",
        causaleAltro: "Distribuzione sintetica D64",
        operatoreId: actor,
        audit: audit(),
        source: {
          naturaContabile: "DISTRIBUZIONE_FINALE",
          dominioOrigine: "MAGAZZINO",
          entitaOrigineTipo: "scarico",
          entitaOrigineId: 0,
          canaleOperativo: "PACCHI",
        },
        operazioneDistribuzione: {
          canaleOperativo: "PACCHI",
          dominioOrigine: "MAGAZZINO",
          entitaOrigineTipo: "scarico",
          entitaOrigineId: 0,
          numeroPacchi: 1,
          numeroPasti: 0,
          indigentiSaltuari: 1,
          indigentiContinuativi: 0,
          areaOperativaIdSnapshot: area,
          territorioClassificazione: "attribuito",
        },
        righe: [
          { prodottoId: product, quantita: 2, unitaMisura: "pz", lottoId: lot },
        ],
      }),
    );
    expect(scarico).toBeGreaterThan(0);
    const before = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lot));
    expect(InventoryDecimal.parse(before[0].quantitaResidua).toDb()).toBe(
      "18.000000",
    );
    const result = await calculateFseReconciliation(command(current));
    const observation = (
      await db
        .select()
        .from(fseAdministrativeObservationsTable)
        .where(
          eq(
            fseAdministrativeObservationsTable.versionId,
            result.reconciliation.administrativeVersionId!,
          ),
        )
    )[0];
    const paired = (
      await pool.query(
        "SELECT * FROM riconciliazioni_fse_righe WHERE riconciliazione_id=$1 AND observation_id=$2",
        [result.reconciliation.id, observation.id],
      )
    ).rows;
    expect(paired).toHaveLength(1);
    expect(paired[0]).toMatchObject({
      status: "RICONCILIATA_ESATTA",
      exact: true,
    });
    expect(paired[0].movimento_id).toBeGreaterThan(0);
    expect(
      (
        await pool.query(
          "SELECT id FROM fse_administrative_lineage WHERE observation_id=$1",
          [observation.id],
        )
      ).rows,
    ).toEqual([]);
    expect(
      await db.select().from(lottiTable).where(eq(lottiTable.id, lot)),
    ).toEqual(before);
  });
  it("D20: concurrent same command replays; divergent intention conflicts", async () => {
    const session = await acquire();
    const input = command(session);
    const [a, b] = await Promise.all([
      calculateFseReconciliation(input),
      calculateFseReconciliation(input),
    ]);
    expect(a.reconciliation.id).toBe(b.reconciliation.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    await expect(
      calculateFseReconciliation({ ...input, dataRiferimento: "2026-09-18" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("D17: initial balance uses proven coverage, exact aggregate and no synthetic movement reference", async () => {
    const wh = await createMagazzino(scope, null, { areaOperativaId: area });
    const [src] = await db
      .insert(fseSourceRegistriesTable)
      .values({
        codice: `SALDO-${randomUUID()}`,
        descrizione: "Saldo M64 sintetico",
        areaOperativaId: area,
        creatoDa: actor,
      })
      .returning();
    const common = {
      sourceRegistryId: src.id,
      areaOperativaId: area,
      magazzinoId: wh,
      lottoLogicoId: logical,
      modalita: "SALDO_INIZIALE" as const,
      actorId: actor,
      audit: audit(),
    };
    const loaded = await db.transaction((tx) =>
      acquireFseFile(tx, {
        ...common,
        buffer: fixture(),
        nomeFile: "registro-sintetico.xlsx",
        profile: "REGISTRO",
      }),
    );
    const headers = [
      "Denominazione OpN",
      "Denominazione OpC",
      "Denominazione OpT",
      "CodiceAccesso",
      "Fondo",
      "Prodotto",
      "Lotto",
      "PesoUnita",
      "UnitaMisuraPeso",
      "GiacenzaPesoVolume",
      "GiacenzaPezzi",
      "PezziPerCollo",
      "GiacenzaColli",
      "CheckModificaGiacenza",
      "Scadenza",
    ];
    const w = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      w,
      XLSX.utils.aoa_to_sheet([
        headers,
        [
          "Sintetico",
          "Sintetico",
          "Sintetico",
          "NOT-A-REAL-CODE",
          "FSE+",
          "Prodotto M64 sintetico",
          "LOT-M64",
          null,
          null,
          null,
          10,
          null,
          0,
          false,
          null,
        ],
      ]),
      "Giacenze",
    );
    await db.transaction((tx) =>
      acquireFseFile(tx, {
        ...common,
        buffer: Buffer.from(
          XLSX.write(w, { type: "buffer", bookType: "xlsx" }),
        ),
        nomeFile: "giacenze-sintetiche.xlsx",
        profile: "GIACENZE",
        referenceDate: "2026-09-17",
        sessionId: loaded.sessionId,
      }),
    );
    const current = async () =>
      (
        await db
          .select()
          .from(fseImportSessionsTable)
          .where(eq(fseImportSessionsTable.id, loaded.sessionId))
      )[0];
    let s = await current();
    await db.transaction((tx) =>
      mapFseProduct(tx, {
        sessionId: s.id,
        version: s.versione,
        externalDescription: "Prodotto M64 sintetico",
        productId: product,
        actorId: actor,
        reason: "Saldo sintetico associato",
        acceptDateFallback: false,
        audit: audit(),
      }),
    );
    s = await current();
    const before = await calculateFseReconciliation({
      ...command(s),
      magazzinoId: wh,
    });
    expect(before.rows.some((r) => r.status === "BASELINE_ASSORBITA")).toBe(
      false,
    );
    const attached = await db.transaction((tx) =>
      addFseRowsToPractice(tx, {
        sessionId: s.id,
        version: s.versione,
        idempotencyKey: randomUUID(),
        historicalCoverageConfirmed: true,
        actorId: actor,
        audit: audit(),
      }),
    );
    const app = makeScopedApp(caricoRouter, {
      id: actor,
      isAdmin: true,
      areaOperativaId: area,
      centroAscoltoId: null,
      aree: ["magazzino"],
      permessi: ["magazzino.stock.receive"],
    });
    const practice = await request(app).get(
      `/carico-pratiche/${attached.practiceId}`,
    );
    expect(practice.status, practice.text).toBe(200);
    const registered = await request(app)
      .post(`/carico-pratiche/${attached.practiceId}/registra`)
      .send({
        versione: practice.body.versione,
        rigaIds: practice.body.righe.map((r: { id: number }) => r.id),
        idempotencyKey: randomUUID(),
      });
    expect(registered.status, registered.text).toBe(201);
    const physical = (
      await pool.query(
        "SELECT count(*)::int n,sum(quantita)::text q FROM movimenti WHERE magazzino_id=$1",
        [wh],
      )
    ).rows;
    const after = await calculateFseReconciliation({
      ...command(await current()),
      magazzinoId: wh,
    });
    expect(after.rows.some((r) => r.status === "BASELINE_ASSORBITA")).toBe(
      true,
    );
    expect(after.rows.filter((r) => r.tipoRiga === "SALDO_PARTITA")).toEqual([
      expect.objectContaining({
        status: "SALDO_RICONCILIATO",
        piecesLocal: "10.000000",
        piecesExternal: "10.000000",
        kgLtLocal: null,
        kgLtExternal: null,
        importazioneAgeaRigaId: null,
        aggregationKey: {
          fund: "FSE_PLUS",
          productId: product,
          lot: "LOT-M64",
          unit: "pz",
        },
      }),
    ]);
    expect(
      after.rows
        .filter((r) => r.tipoRiga === "SALDO_PARTITA")
        .every((r) => r.observationId == null),
    ).toBe(true);
    expect(after.rows.every((r) => r.movimentoId == null)).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n,sum(quantita)::text q FROM movimenti WHERE magazzino_id=$1",
          [wh],
        )
      ).rows,
    ).toEqual(physical);
  });
  it("D04: source lock serializes mapping; stale confirmation conflicts without a mixed manifest", async () => {
    const session = await acquire();
    let pending: Promise<unknown> | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-source:${source}`},0))`,
        );
        const pid = (await tx.execute(sql`SELECT pg_backend_pid() pid`)).rows[0]
          .pid;
        pending = calculateFseReconciliation(command(session)).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        const deadline = Date.now() + 5000;
        while (
          !(
            await pool.query(
              "SELECT exists(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) waiting",
              [pid],
            )
          ).rows[0].waiting
        ) {
          if (Date.now() > deadline)
            throw Error("No PostgreSQL source barrier");
          await new Promise((r) => setImmediate(r));
        }
        // Actual writer, after observing the calculation waiting in PostgreSQL.
        await mapFseProduct(tx, {
          sessionId: session.id,
          version: session.versione,
          externalDescription: "Prodotto M64 sintetico",
          productId: product,
          reason: "Mapping reale concorrente",
          acceptDateFallback: false,
          actorId: actor,
          audit: audit(),
        });
      });
      expect(await pending).toMatchObject({ error: { status: 409 } });
      const current = (
        await pool.query(
          "SELECT versione FROM fse_import_sessions WHERE id=$1",
          [session.id],
        )
      ).rows[0];
      expect(current.versione).toBeGreaterThan(session.versione);
      const mapped = await db
        .select({ prodottoId: fseImportRowsTable.prodottoId })
        .from(fseImportRowsTable)
        .where(eq(fseImportRowsTable.sessioneId, session.id));
      expect(mapped.length).toBeGreaterThan(0);
      expect(mapped.every((row) => row.prodottoId === product)).toBe(true);
      expect(
        await db
          .select()
          .from(fseAdministrativeVersionsTable)
          .where(eq(fseAdministrativeVersionsTable.sessionId, session.id)),
      ).toEqual([]);
    } finally {
      if (pending) await pending;
    }
  });
  it("D04: a locked M3A practice yields conflict instead of an inverted-lock deadlock", async () => {
    const session = await acquire();
    const rows = await db
      .select()
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.sessioneId, session.id));
    const attached = await db.transaction((tx) =>
      addFseRowsToPractice(tx, {
        sessionId: session.id,
        version: session.versione,
        rowIds: rows.map((r) => r.id),
        idempotencyKey: randomUUID(),
        historicalCoverageConfirmed: false,
        actorId: actor,
        audit: audit(),
      }),
    );
    const [current] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, session.id));
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM carico_pratiche WHERE id=$1 FOR UPDATE",
        [attached.practiceId],
      );
      await expect(
        calculateFseReconciliation(command(current)),
      ).rejects.toMatchObject({
        status: 409,
        message:
          "Pratica in registrazione: riprovare il confronto dopo il completamento",
      });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("D06: corrected quantity keeps original raw and never obtains exact equivalence", async () => {
    const session = await acquire();
    const [row] = await db
      .select()
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.sessioneId, session.id));
    await db.transaction((tx) =>
      reviseFseImportRow(tx, {
        sessionId: session.id,
        rowId: row.id,
        version: session.versione,
        quantity: "7",
        reason: "Correzione quantità sintetica documentata",
        acceptDateFallback: false,
        actorId: actor,
        audit: audit(),
      }),
    );
    const [current] = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, session.id));
    const result = await calculateFseReconciliation(command(current));
    const [o] = await db
      .select()
      .from(fseAdministrativeObservationsTable)
      .where(
        eq(
          fseAdministrativeObservationsTable.versionId,
          result.reconciliation.administrativeVersionId!,
        ),
      );
    expect(o.originalJson.pieces).toBe("10.000000");
    expect(o.interpretedJson.pieces).toBe("7.000000");
    expect(o.qualityJson).toContain("CORREZIONE_INTENZIONALE");
    expect(o.revisionId).toBeGreaterThan(0);
    expect(result.rows.find((r) => r.observationId === o.id)).toMatchObject({
      blocking: true,
    });
    expect(
      (
        await pool.query(
          "SELECT exact,blocking FROM riconciliazioni_fse_righe WHERE riconciliazione_id=$1 AND observation_id=$2",
          [result.reconciliation.id, o.id],
        )
      ).rows,
    ).toEqual([{ exact: false, blocking: true }]);
  });
  it("D11/D12: explicit prior run, missing observation belongs to the frozen baseline", async () => {
    const doc = randomUUID(),
      previous = await acquire(2, fixture(doc, 2));
    const a = await calculateFseReconciliation(command(previous));
    const [baseline] = await db
      .select()
      .from(fseReconciliationRunsTable)
      .where(
        eq(fseReconciliationRunsTable.reconciliationId, a.reconciliation.id),
      );
    await recalculateFseReconciliation({
      id: a.reconciliation.id,
      versione: 1,
      sessionVersion: previous.versione,
      actorId: actor,
      audit: audit(),
    });
    const current = await acquire(1, fixture(doc, 1, "18/09/2026"));
    const b = await calculateFseReconciliation({
      ...command(current),
      dataRiferimento: "2026-09-18",
      baselineRunId: baseline.id,
    });
    expect(b.reconciliation.baselineRunId).toBe(baseline.id);
    const missing = b.rows.filter(
      (r) => r.status === "MOVIMENTO_AGEA_SCOMPARSO",
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].observationId).toBeGreaterThan(0);
    const [o] = await db
      .select()
      .from(fseAdministrativeObservationsTable)
      .where(
        eq(fseAdministrativeObservationsTable.id, missing[0].observationId!),
      );
    expect(o.versionId).toBe(baseline.administrativeVersionId);
  });
  it("D20: replay returns the committed receipt after later recalculation", async () => {
    const session = await acquire();
    const input = command(session);
    const first = await calculateFseReconciliation(input);
    await recalculateFseReconciliation({
      id: first.reconciliation.id,
      versione: 1,
      sessionVersion: session.versione,
      actorId: actor,
      audit: audit(),
    });
    const replay = await calculateFseReconciliation(input);
    expect(replay.replayed).toBe(true);
    expect(replay.reconciliation.versione).toBe(1);
    expect(replay.rows).toEqual(first.rows);
  });
  it("D21: revocation before the protected actor check denies a waiting calculation", async () => {
    const session = await acquire();
    const blocker = await pool.connect();
    let result: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`fse-source:${source}`],
      );
      const {
        rows: [{ pid }],
      } = await blocker.query("SELECT pg_backend_pid() AS pid");
      result = calculateFseReconciliation(command(session)).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      const deadline = Date.now() + 5000;
      while (true) {
        const blocked = await pool.query(
          "SELECT exists(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting",
          [pid],
        );
        if (blocked.rows[0].waiting) break;
        if (Date.now() > deadline)
          throw new Error("Calculation never reached the PostgreSQL barrier");
        await new Promise((resolve) => setImmediate(resolve));
      }
      await db
        .update(ruoliTable)
        .set({ isAdmin: false, permessi: [] })
        .where(eq(ruoliTable.id, role));
      await blocker.query("COMMIT");
      const outcome = (await result) as { error?: { status?: number } };
      expect(outcome.error).toMatchObject({ status: 403 });
      expect(
        await db
          .select()
          .from(fseAdministrativeVersionsTable)
          .where(eq(fseAdministrativeVersionsTable.sessionId, session.id)),
      ).toEqual([]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (result) await result;
      await db
        .update(ruoliTable)
        .set({ isAdmin: true, permessi: permissions })
        .where(eq(ruoliTable.id, role));
    }
  });
  it("D21: revocation while resolution waits on the header denies without changing rows or audit", async () => {
    const session = await acquire();
    const result = await calculateFseReconciliation(command(session));
    const id = result.reconciliation.id;
    const before = (
      await pool.query(
        "SELECT * FROM riconciliazioni_fse_righe WHERE riconciliazione_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM riconciliazioni_fse WHERE id=$1 FOR UPDATE",
        [id],
      );
      const {
        rows: [{ pid }],
      } = await blocker.query("SELECT pg_backend_pid() AS pid");
      pending = request(api())
        .patch(`/fse/riconciliazioni/${id}/righe/${before[0].id}`)
        .send({
          versione: 1,
          azione: "ACCETTA_SCOSTAMENTO",
          motivazione: "Verifica revoca durante attesa",
        })
        .then((r) => r);
      const deadline = Date.now() + 5000;
      while (
        !(
          await pool.query(
            "SELECT exists(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) waiting",
            [pid],
          )
        ).rows[0].waiting
      ) {
        if (Date.now() > deadline)
          throw new Error("Resolution never reached the PostgreSQL barrier");
        await new Promise((resolve) => setImmediate(resolve));
      }
      await db
        .update(ruoliTable)
        .set({ isAdmin: false, permessi: [] })
        .where(eq(ruoliTable.id, role));
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(
        (
          await pool.query(
            "SELECT * FROM riconciliazioni_fse_righe WHERE riconciliazione_id=$1 ORDER BY id",
            [id],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await pool.query(
            "SELECT versione FROM riconciliazioni_fse WHERE id=$1",
            [id],
          )
        ).rows,
      ).toEqual([{ versione: 1 }]);
      expect(
        (
          await pool.query(
            "SELECT id FROM riconciliazioni_fse_risoluzioni WHERE riconciliazione_id=$1",
            [id],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
      await db
        .update(ruoliTable)
        .set({ isAdmin: true, permessi: permissions })
        .where(eq(ruoliTable.id, role));
    }
  });
  it("D22: observation insertion failure rolls back the whole frozen source", async () => {
    const session = await acquire();
    await pool.query(
      "CREATE FUNCTION test_m64_observation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'M64 observation fault'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER test_m64_observation_fault BEFORE INSERT ON fse_administrative_observations FOR EACH ROW EXECUTE FUNCTION test_m64_observation_fault()",
    );
    try {
      await expect(
        calculateFseReconciliation(command(session)),
      ).rejects.toMatchObject({ cause: { message: "M64 observation fault" } });
      expect(
        await db
          .select()
          .from(fseAdministrativeVersionsTable)
          .where(eq(fseAdministrativeVersionsTable.sessionId, session.id)),
      ).toEqual([]);
    } finally {
      await pool.query(
        "DROP TRIGGER test_m64_observation_fault ON fse_administrative_observations",
      );
      await pool.query("DROP FUNCTION test_m64_observation_fault()");
    }
  });
  it("D22: audit failure rolls back frozen manifest, rows and command receipt", async () => {
    const session = await acquire();
    const key = randomUUID();
    await pool.query(
      `CREATE FUNCTION test_m64_source_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.azione='FSE_RICONCILIAZIONE_CREATA' AND NEW.actor_user_id=${actor} THEN RAISE EXCEPTION 'M64 synthetic audit fault'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      "CREATE TRIGGER test_m64_source_audit_fault BEFORE INSERT ON audit_eventi FOR EACH ROW EXECUTE FUNCTION test_m64_source_audit_fault()",
    );
    try {
      await expect(
        calculateFseReconciliation({ ...command(session), commandKey: key }),
      ).rejects.toMatchObject({
        cause: { message: "M64 synthetic audit fault" },
      });
      expect(
        await db
          .select()
          .from(fseAdministrativeVersionsTable)
          .where(eq(fseAdministrativeVersionsTable.sessionId, session.id)),
      ).toEqual([]);
      expect(
        (
          await pool.query(
            "SELECT id FROM riconciliazioni_fse WHERE command_key=$1",
            [key],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await pool.query(
        "DROP TRIGGER test_m64_source_audit_fault ON audit_eventi",
      );
      await pool.query("DROP FUNCTION test_m64_source_audit_fault()");
    }
  });
  it("D10/D11: a run of the same period is not an earlier cumulative period", async () => {
    const session = await acquire();
    const a = await calculateFseReconciliation(command(session));
    const [run] = await db
      .select()
      .from(fseReconciliationRunsTable)
      .where(
        eq(fseReconciliationRunsTable.reconciliationId, a.reconciliation.id),
      );
    await expect(
      calculateFseReconciliation({
        ...command(session),
        baselineRunId: run.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("D03: mismatched warehouse is denied and typed references cannot be mixed", async () => {
    const session = await acquire();
    const other = await createMagazzino(scope, null, { areaOperativaId: area });
    await expect(
      calculateFseReconciliation({ ...command(session), magazzinoId: other }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      calculateFseReconciliation({
        ...command(session),
        importazioneAgeaId: session.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("D14/D16: SQL ownership and append-only source guards", async () => {
    const session = await acquire();
    const a = await calculateFseReconciliation(command(session));
    await expect(
      pool.query(
        "UPDATE fse_administrative_versions SET session_version=session_version+1 WHERE id=$1",
        [a.reconciliation.administrativeVersionId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const [row] = await db
      .select()
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.sessioneId, session.id));
    expect(row).toBeDefined();
    const b = await calculateFseReconciliation(command(session));
    expect(b.reconciliation.id).not.toBe(a.reconciliation.id);
    expect(b.reconciliation.administrativeVersionId).toBe(
      a.reconciliation.administrativeVersionId,
    );
  });
  it("F12: HTTP source listing, calculation and source provenance", async () => {
    const session = await acquire();
    const sources = await request(api()).get(
      `/fse/fonti-m3b?magazzinoId=${warehouse}`,
    );
    expect(sources.status, sources.text).toBe(200);
    expect(
      sources.body.rows.some((r: { id: number }) => r.id === session.id),
    ).toBe(true);
    const created = await request(api())
      .post("/fse/riconciliazioni")
      .send(command(session));
    expect(created.status, created.text).toBe(201);
    const detail = await request(api()).get(
      `/fse/riconciliazioni/${created.body.id}/fonte`,
    );
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.source.sessionId).toBe(session.id);
    expect(detail.body.runs).toHaveLength(1);
  });
  it("D14/D15/D16: direct SQL rejects cross-version, dual references and active double consumption", async () => {
    const a = await calculateFseReconciliation(command(await acquire()));
    const b = await calculateFseReconciliation(command(await acquire()));
    const row = (
      await pool.query(
        "SELECT id,observation_id FROM riconciliazioni_fse_righe WHERE riconciliazione_id=$1 AND observation_id IS NOT NULL",
        [a.reconciliation.id],
      )
    ).rows[0];
    await expect(
      pool.query(
        "UPDATE riconciliazioni_fse_righe SET riconciliazione_id=$1 WHERE id=$2",
        [b.reconciliation.id, row.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "UPDATE riconciliazioni_fse_righe SET importazione_agea_riga_id=observation_id WHERE id=$1",
        [row.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "INSERT INTO riconciliazioni_fse_righe (riconciliazione_id,tipo_riga,business_key,match_method,status,blocking,content_hash,observation_id) VALUES ($1,'CARICO','duplicate-observation','NESSUNO','SOLO_AGEA',true,$2,$3)",
        [a.reconciliation.id, "a".repeat(64), row.observation_id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      pool.query(
        "INSERT INTO riconciliazioni_fse_righe (riconciliazione_id,tipo_riga,business_key,match_method,status,blocking,content_hash) VALUES ($1,'CARICO','fake-external','NESSUNO','SOLO_AGEA',true,$2)",
        [a.reconciliation.id, "b".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "INSERT INTO riconciliazioni_fse_righe (riconciliazione_id,tipo_riga,business_key,match_method,status,blocking,content_hash,aggregate_version_id) VALUES ($1,'SALDO_PARTITA','wrong-aggregate','NESSUNO','SOLO_AGEA',true,$2,$3)",
        [
          a.reconciliation.id,
          "c".repeat(64),
          b.reconciliation.administrativeVersionId,
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await pool.query(
          "SELECT riconciliazione_id,importazione_agea_riga_id FROM riconciliazioni_fse_righe WHERE id=$1",
          [row.id],
        )
      ).rows,
    ).toEqual([
      {
        riconciliazione_id: a.reconciliation.id,
        importazione_agea_riga_id: null,
      },
    ]);
  });
});

async function lifecycleReconciliation(sourceType: "AGEA_LEGACY" | "FSE_M3B") {
  if (sourceType === "FSE_M3B")
    return calculateFseReconciliation(command(await acquire()));
  // Authentic legacy FK and raw identity: never use a M3B ID as a legacy import.
  const [legacy] = await db
    .insert(importazioniAgeaTable)
    .values({
      magazzinoId: warehouse,
      nomeFile: "legacy-lifecycle-sintetico.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dimensioneBytes: 100,
      sha256File: randomUUID().replaceAll("-", "").repeat(2),
      tracciatoCodice: "SIFEAD_REGISTRO_XLSX_OSSERVATO_V1",
      parserVersion: "2.0B-R2.0",
      sheetName: "Table1",
      dataRiferimento: "2026-09-17",
      modalita: "SOLO_ANALISI",
      stato: "CONFERMATA",
      creatoDa: actor,
      confermatoDa: actor,
      dataConferma: new Date(),
    })
    .returning();
  const identity = randomUUID().replaceAll("-", "").repeat(2);
  await db.insert(importazioniAgeaRigheTable).values({
    importazioneId: legacy.id,
    numeroRiga: 2,
    rawJson: {},
    fondoRaw: "FSE+",
    fondoNormalizzato: "FSE_PLUS",
    prodottoRaw: "Prodotto legacy sintetico",
    prodottoNormalizzato: "PRODOTTO LEGACY SINTETICO",
    lottoRaw: "LIFECYCLE",
    lottoNormalizzato: "LIFECYCLE",
    dataDocumento: "2026-09-17",
    movimentoPezzi: "10",
    tipoMovimentoEsterno: "CARICO",
    identityBaseHash: identity,
    identityOccurrence: 1,
    identityKey: identity + ":1",
    contentHash: identity,
    prodottoIdSnapshot: product,
    statoRiga: "NUOVA",
    blocking: false,
  });
  return calculateFseReconciliation({
    sourceType,
    importazioneAgeaId: legacy.id,
    magazzinoId: warehouse,
    dataRiferimento: "2026-09-17",
    creatoDa: actor,
    audit: audit(),
  });
}
async function lifecycleSnapshot(id: number) {
  const snapshot: Record<string, unknown> = {};
  for (const [table, column] of [
    ["riconciliazioni_fse_righe", "riconciliazione_id"],
    ["fse_reconciliation_runs", "reconciliation_id"],
  ]) {
    snapshot[table] = (
      await pool.query(
        `SELECT * FROM ${table} WHERE ${column}=$1 ORDER BY id`,
        [id],
      )
    ).rows;
  }
  snapshot.stock = (
    await pool.query(
      "SELECT id, quantita_residua FROM lotti WHERE magazzino_id=$1 ORDER BY id",
      [warehouse],
    )
  ).rows;
  snapshot.movements = (
    await pool.query(
      "SELECT * FROM movimenti WHERE magazzino_id=$1 ORDER BY id",
      [warehouse],
    )
  ).rows;
  snapshot.claims = (
    await pool.query(
      "SELECT * FROM fse_movement_claims WHERE source_registry_id=$1 ORDER BY id",
      [source],
    )
  ).rows;
  return snapshot;
}
