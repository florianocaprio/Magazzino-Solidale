/** Synthetic populated-v50 fixture. Run only through the guarded M64 launcher. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import request from "supertest";
import {
  db,
  pool,
  ruoliTable,
  utentiTable,
  lottiLogiciTable,
  fseSourceRegistriesTable,
  fseImportSessionsTable,
  fseImportRowsTable,
  importazioniAgeaTable,
  esportazioniFseTable,
  esportazioniFseEventiTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createAreaOperativa,
  createMagazzino,
  createProdotto,
  createRuolo,
  createUtente,
  newScope,
  makeScopedApp,
} from "../scope-helpers";
import {
  acquireFseFile,
  mapFseProduct,
  reviseFseImportRow,
  addFseRowsToPractice,
} from "../../src/lib/fsePracticeImportService";
import caricoRouter from "../../src/routes/carico-pratiche";

export async function populateM64UpgradeFixture() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "58641");
  assert.match(url.pathname, /^\/m64_upgrade(?:_[a-z0-9]+)?$/);
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) n FROM app_meta.schema_migrations"))
        .rows[0].n,
    ),
    50,
  );
  const s = newScope(),
    area = await createAreaOperativa(s),
    warehouse = await createMagazzino(s, null, { areaOperativaId: area });
  const role = await createRuolo(s, { isAdmin: true });
  await db
    .update(ruoliTable)
    .set({
      aree: ["magazzino"],
      permessi: [
        "magazzino.agea.import",
        "magazzino.fse.view",
        "magazzino.fse.reconcile",
      ],
    })
    .where(eq(ruoliTable.id, role));
  const actor = await createUtente(s, { ruoloId: role }),
    product = await createProdotto(s, { unitaMisura: "pz" });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: area })
    .where(eq(utentiTable.id, actor));
  const [lot] = await db
    .insert(lottiLogiciTable)
    .values({
      areaOperativaId: area,
      codice: `UPGRADE-${randomUUID()}`,
      descrizione: "Fixture sintetica upgrade",
    })
    .returning();
  const [source] = await db
    .insert(fseSourceRegistriesTable)
    .values({
      codice: `UPGRADE-${randomUUID()}`,
      descrizione: "Fonte upgrade sintetica",
      areaOperativaId: area,
      creatoDa: actor,
    })
    .returning();
  const headers = [
    "Fondo",
    "Prodotto",
    "Giacenza al 17/09/2026 Pezzi",
    "Giacenza al 17/09/2026 KgLt",
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
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      headers,
      ...[1, 2].map((i) => [
        "FSE+",
        "Prodotto upgrade sintetico",
        20,
        null,
        `UPGRADE-${i}`,
        "17/09/2026",
        "17/09/2026",
        "LOT-UPGRADE",
        "OpC sintetico",
        null,
        10,
        20,
        null,
        "NOTE-SINTETICHE-UPGRADE",
        null,
        null,
        null,
        null,
        null,
      ]),
    ]),
    "Registro",
  );
  const audit = () => ({
    actor: {
      actorType: "user" as const,
      actorUserId: actor,
      actorCodeSnapshot: "M64-UPGRADE",
      initiatedByUserId: null,
      initiatedByCodeSnapshot: null,
    },
    correlationId: randomUUID(),
  });
  const acquired = await db.transaction((tx) =>
    acquireFseFile(tx, {
      buffer: Buffer.from(
        XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
      ),
      nomeFile: "upgrade-sintetico.xlsx",
      profile: "REGISTRO",
      sourceRegistryId: source.id,
      areaOperativaId: area,
      magazzinoId: warehouse,
      lottoLogicoId: lot.id,
      modalita: "NUOVI_CARICHI",
      actorId: actor,
      audit: audit(),
    }),
  );
  const session = async () =>
    (
      await db
        .select()
        .from(fseImportSessionsTable)
        .where(eq(fseImportSessionsTable.id, acquired.sessionId))
    )[0];
  const acquiredVersion = (await session()).versione;
  await db.transaction((tx) =>
    mapFseProduct(tx, {
      sessionId: acquired.sessionId,
      version: acquiredVersion,
      externalDescription: "Prodotto upgrade sintetico",
      productId: product,
      actorId: actor,
      reason: "Mapping fixture upgrade",
      acceptDateFallback: false,
      audit: audit(),
    }),
  );
  const rows = await db
    .select()
    .from(fseImportRowsTable)
    .where(eq(fseImportRowsTable.sessioneId, acquired.sessionId));
  // A real correction records raw/corrected aliases; no hand-made claim.
  let current = await session();
  await db.transaction((tx) =>
    reviseFseImportRow(tx, {
      sessionId: acquired.sessionId,
      rowId: rows[0].id,
      version: current.versione,
      physicalLot: "LOT-UPGRADE-CORRETTO",
      acceptDateFallback: false,
      reason: "Correzione lotto documentata della fixture",
      actorId: actor,
      audit: audit(),
    }),
  );
  current = await session();
  const attached = await db.transaction((tx) =>
    addFseRowsToPractice(tx, {
      sessionId: current.id,
      version: current.versione,
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
  assert.equal(practice.status, 200, practice.text);
  const registered = await request(app)
    .post(`/carico-pratiche/${attached.practiceId}/registra`)
    .send({
      versione: practice.body.versione,
      rigaIds: [practice.body.righe[0].id],
      idempotencyKey: randomUUID(),
    });
  assert.equal(registered.status, 201, registered.text);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM fse_movement_identity_aliases WHERE source_registry_id=$1",
        [source.id],
      )
    ).rows[0].n,
    3,
  );
  const [legacy] = await db
    .insert(importazioniAgeaTable)
    .values({
      magazzinoId: warehouse,
      nomeFile: "legacy-upgrade-sintetico.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dimensioneBytes: 100,
      sha256File: "a".repeat(64),
      tracciatoCodice: "SIFEAD_REGISTRO_XLSX_OSSERVATO_V1",
      parserVersion: "2.0B-R2.0",
      sheetName: "Table1",
      dataRiferimento: "2026-09-17",
      modalita: "SOLO_ANALISI",
      stato: "CONFERMATA",
      creatoDa: actor,
      noteAudit: { synthetic: "UPGRADE-PRIVATE-SENTINEL" },
    })
    .returning();
  // Explicit v50 columns: this must fail if the fixture silently depends on v51/52.
  for (const state of ["DA_RIVEDERE", "CHIUSA_CON_SCOSTAMENTI"]) {
    const h = (
      await pool.query(
        "INSERT INTO riconciliazioni_fse (magazzino_id,importazione_agea_id,data_riferimento,max_movimento_id,max_operazione_distribuzione_id,model_version,canonical_hash,stato,creato_da) VALUES ($1,$2,'2026-09-17',0,0,'MAGAZZINO_2_0C_R1_V2',$3,$4,$5) RETURNING id",
        [warehouse, legacy.id, "b".repeat(64), state, actor],
      )
    ).rows[0];
    for (const type of ["MOVIMENTO", "SALDO_PARTITA"])
      await pool.query(
        "INSERT INTO riconciliazioni_fse_righe (riconciliazione_id,tipo_riga,business_key,match_method,status,blocking,content_hash,calculated_state_json) VALUES ($1,$2,$3,'NESSUNO','SOLO_LOCALE_DA_RENDICONTARE',true,$4,$5)",
        [
          h.id,
          type,
          `${state}:${type}`,
          "c".repeat(64),
          JSON.stringify({ synthetic: true, pieces: "10.000000", kgLt: null }),
        ],
      );
  }
  const [historical] = await db
    .insert(esportazioniFseTable)
    .values({
      magazzinoId: warehouse,
      dataDa: "2026-09-01",
      dataA: "2026-09-17",
      dataAsOf: "2026-09-17",
      formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
      modelVersion: "MAGAZZINO_2_0C_R1_V2",
      stato: "INSERITA_MANUALMENTE",
      maxMovimentoId: 0,
      maxOperazioneDistribuzioneId: 0,
      canonicalHash: "d".repeat(64),
      idempotencyKey: "e".repeat(64),
      eventiTotali: 1,
      righeTotali: 0,
      righeBloccanti: 0,
      righeWarning: 0,
      creatoDa: actor,
      snapshotMetadataJson: { noteAudit: "UPGRADE-PRIVATE-SENTINEL" },
      marcatoInseritoDa: actor,
      dataInserimentoEsterno: new Date(),
    })
    .returning();
  await db.insert(esportazioniFseEventiTable).values({
    esportazioneId: historical.id,
    eventKey: "SYNTHETIC-HISTORICAL-COVERAGE",
    contentHash: "f".repeat(64),
    sourceType: "DISTRIBUZIONE",
    sourceId: 1,
    eventDate: "2026-09-17",
    status: "OK",
    activeCoverage: true,
    coveredAt: new Date(),
    administrativeStatus: "INSERITO_MANUALMENTE",
  });
  return {
    area,
    warehouse,
    role,
    actor,
    product,
    source: source.id,
    sessionId: acquired.sessionId,
    legacyImportId: legacy.id,
    historicalExportId: historical.id,
  };
}
