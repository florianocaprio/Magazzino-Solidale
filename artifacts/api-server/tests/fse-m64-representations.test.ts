/* @vitest-environment node */
import { randomUUID, createHash } from "node:crypto";
import {
  db,
  pool,
  ruoliTable,
  utentiTable,
  esportazioniFseTable,
  esportazioniFseIndicatoriTable,
  esportazioniFseRappresentazioniTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import request from "supertest";
import fseRouter from "../src/routes/fse";
import { downloadFseRepresentation } from "../src/lib/fseExportRepresentation";
import {
  FSE_CANONICAL_FORMAT,
  FSE_OBSERVED_CONTROL_FORMAT,
  canonicalSha256,
} from "../src/lib/fseCanonicalReporting";
import {
  minimizedExportEvent,
  minimizedExportHeader,
  minimizedExportLine,
} from "../src/lib/fseExportMinimization";
import {
  FSE_ORIGINAL_PERMISSION,
  adminPermissionsWithExplicitOriginal,
  DEFAULT_ADMIN_PERMISSION_KEYS,
} from "../src/lib/permissions";
import {
  ensureSuperAdminRole,
  seedRoles,
  ADMIN_ROLE_NAME,
} from "../src/lib/seedRoles";
import {
  createAreaOperativa,
  createMagazzino,
  createRuolo,
  createUtente,
  makeScopedApp,
  newScope,
} from "./scope-helpers";

const scope = newScope();
let area: number,
  warehouse: number,
  actor: number,
  role: number,
  exportId: number;
const sentinel = "M64_PRIVATE_ORIGINAL_SENTINEL@example.invalid";
const audit = () => ({
  actor: {
    actorType: "user" as const,
    actorUserId: actor,
    actorCodeSnapshot: "M64-TEST",
    initiatedByUserId: null,
    initiatedByCodeSnapshot: null,
  },
  correlationId: randomUUID(),
});
const api = () =>
  makeScopedApp(fseRouter, {
    id: actor,
    isAdmin: true,
    areaOperativaId: area,
    centroAscoltoId: null,
    aree: ["magazzino"],
    permessi: ["magazzino.fse.view", FSE_ORIGINAL_PERMISSION],
  });
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const workbookText = (b: Buffer) => {
  const w = XLSX.read(b, { type: "buffer" });
  expect(w.vbaraw).toBeUndefined();
  return JSON.stringify(
    w.SheetNames.map((name) =>
      XLSX.utils.sheet_to_json(w.Sheets[name], { header: 1, defval: null }),
    ),
  );
};
beforeAll(async () => {
  area = await createAreaOperativa(scope);
  warehouse = await createMagazzino(scope, null, { areaOperativaId: area });
  role = await createRuolo(scope, { isAdmin: true });
  await db
    .update(ruoliTable)
    .set({ aree: ["magazzino"], permessi: ["magazzino.fse.view"] })
    .where(eq(ruoliTable.id, role));
  actor = await createUtente(scope, { ruoloId: role });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: area })
    .where(eq(utentiTable.id, actor));
  const [row] = await db
    .insert(esportazioniFseTable)
    .values({
      magazzinoId: warehouse,
      dataDa: "2026-09-01",
      dataA: "2026-09-30",
      dataAsOf: "2026-09-30",
      formatCode: FSE_CANONICAL_FORMAT,
      modelVersion: "MAGAZZINO_2_0C_R1_V2",
      stato: "GENERATA_CON_BLOCCHI",
      maxMovimentoId: 0,
      maxOperazioneDistribuzioneId: 0,
      canonicalHash: canonicalSha256({ sentinel }),
      idempotencyKey: canonicalSha256(randomUUID()),
      eventiTotali: 0,
      righeTotali: 0,
      righeBloccanti: 1,
      righeWarning: 0,
      creatoDa: actor,
      snapshotMetadataJson: { magazzinoId: warehouse, unknown: sentinel },
      motivazioneAnnullamento: sentinel,
    })
    .returning();
  exportId = row.id;
  await db.insert(esportazioniFseIndicatoriTable).values({
    esportazioneId: exportId,
    annoMese: "2026-09",
    canaleUfficiale: "PACCHI",
    dataRiferimento: "2026-09-30",
    valuesJson: {
      minori18: null,
      donne: 0,
      fonte: "RILEVAZIONE_MANUALE_VERIFICATA",
      noteAudit: sentinel,
      unexpected: { phone: sentinel },
    },
    contentHash: canonicalSha256({ sentinel }),
  });
});
// Append-only evidence survives until the disposable database is removed by the launcher.
afterAll(async () => {
  await pool.end();
});
describe("M6.4 D64-02 — historical representations", () => {
  it.each([FSE_CANONICAL_FORMAT, FSE_OBSERVED_CONTROL_FORMAT])(
    "D23/D24/D25/D28/D29: %s minimization and byte-identical replay",
    async (format) => {
      const before = await db
        .select()
        .from(esportazioniFseTable)
        .where(eq(esportazioniFseTable.id, exportId));
      const [a, b] = await Promise.all([
        downloadFseRepresentation({ id: exportId, format, audit: audit() }),
        downloadFseRepresentation({ id: exportId, format, audit: audit() }),
      ]);
      expect(a.buffer.equals(b.buffer)).toBe(true);
      expect(a.representationId).toBe(b.representationId);
      expect(hash(a.buffer)).toBe(a.artifactHash);
      expect(a.semanticHash).not.toBe(a.artifactHash);
      const text = workbookText(a.buffer);
      expect(text).not.toContain(sentinel);
      expect(text).toContain("FSE_MINIMIZED_V1");
      if (format === FSE_CANONICAL_FORMAT) {
        expect(text).toContain("minori18");
        expect(text).toContain("donne");
        expect(text).toContain("null");
      }
      expect(
        await db
          .select()
          .from(esportazioniFseTable)
          .where(eq(esportazioniFseTable.id, exportId)),
      ).toEqual(before);
    },
  );
  it("D26: admin without explicit grant denied, even with an elevated session stub", async () => {
    await expect(
      downloadFseRepresentation({
        id: exportId,
        originalReason: "Audit sintetico",
        audit: audit(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    const response = await request(api())
      .post(`/fse/exportazioni/${exportId}/originale`)
      .send({ motivo: "Audit sintetico" });
    expect(response.status, response.text).toBe(403);
    expect(DEFAULT_ADMIN_PERMISSION_KEYS).not.toContain(
      FSE_ORIGINAL_PERMISSION,
    );
    expect(adminPermissionsWithExplicitOriginal()).not.toContain(
      FSE_ORIGINAL_PERMISSION,
    );
    expect(
      adminPermissionsWithExplicitOriginal([FSE_ORIGINAL_PERMISSION]),
    ).toContain(FSE_ORIGINAL_PERMISSION);
  });
  it("D27/D30: explicit grant + reason, regenerated historical content and audit", async () => {
    await db
      .update(ruoliTable)
      .set({ permessi: ["magazzino.fse.view", FSE_ORIGINAL_PERMISSION] })
      .where(eq(ruoliTable.id, role));
    await expect(
      downloadFseRepresentation({
        id: exportId,
        originalReason: " ",
        audit: audit(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    const file = await downloadFseRepresentation({
      id: exportId,
      originalReason: "Verifica storico sintetico",
      audit: audit(),
    });
    expect(workbookText(file.buffer)).toContain(sentinel);
    expect(file.variant).toBe("STORICO_RIGENERATO_NON_MINIMIZZATO");
    const events = await pool.query(
      "SELECT motivo FROM audit_eventi WHERE entita_tipo='esportazione_fse' AND entita_id=$1 AND azione='FSE_ORIGINALE_CONSULTATO'",
      [exportId],
    );
    expect(events.rows).toEqual([{ motivo: "Verifica storico sintetico" }]);
    await db
      .update(ruoliTable)
      .set({ permessi: ["magazzino.fse.view"] })
      .where(eq(ruoliTable.id, role));
    await expect(
      downloadFseRepresentation({
        id: exportId,
        originalReason: "Dopo revoca",
        audit: audit(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("D23: JSON DTOs and lineage have explicit allowlists", async () => {
    for (const fn of [
      minimizedExportHeader,
      minimizedExportEvent,
      minimizedExportLine,
    ])
      expect(
        JSON.stringify(
          fn({
            id: 1,
            noteAudit: sentinel,
            unknown: sentinel,
            sourceLineageJson: { raw: sentinel },
            snapshotMetadataJson: { note: sentinel },
            grossStatisticsJson: { note: sentinel },
            netStatisticsJson: { note: sentinel },
          }),
        ),
      ).not.toContain(sentinel);
    const response = await request(api()).get(`/fse/exportazioni/${exportId}`);
    expect(response.status, response.text).toBe(200);
    expect(response.text).not.toContain(sentinel);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("D26/D31: canonical role seed does not implicitly assign the exceptional permission", async () => {
    const id = await ensureSuperAdminRole();
    const [before] = await db
      .select()
      .from(ruoliTable)
      .where(eq(ruoliTable.id, id));
    expect(before.permessi).not.toContain(FSE_ORIGINAL_PERMISSION);
    await seedRoles();
    const defaults = await db.select().from(ruoliTable);
    expect(
      defaults.find((r) => r.nome === "SuperAdmin")!.permessi,
    ).not.toContain(FSE_ORIGINAL_PERMISSION);
    expect(
      defaults.find((r) => r.nome === ADMIN_ROLE_NAME)!.permessi,
    ).not.toContain(FSE_ORIGINAL_PERMISSION);
    await db
      .update(ruoliTable)
      .set({ permessi: [...before.permessi, FSE_ORIGINAL_PERMISSION] })
      .where(eq(ruoliTable.id, id));
    try {
      await ensureSuperAdminRole();
      expect(
        (await db.select().from(ruoliTable).where(eq(ruoliTable.id, id)))[0]
          .permessi,
      ).toContain(FSE_ORIGINAL_PERMISSION);
    } finally {
      await db
        .update(ruoliTable)
        .set({ permessi: before.permessi })
        .where(eq(ruoliTable.id, id));
    }
  });
  it("D26: explicit permission never bypasses territory or the application area", async () => {
    const otherArea = await createAreaOperativa(scope);
    await db
      .update(ruoliTable)
      .set({ permessi: ["magazzino.fse.view", FSE_ORIGINAL_PERMISSION] })
      .where(eq(ruoliTable.id, role));
    try {
      await db
        .update(utentiTable)
        .set({ areaOperativaId: otherArea })
        .where(eq(utentiTable.id, actor));
      await expect(
        downloadFseRepresentation({
          id: exportId,
          originalReason: "Fuori territorio",
          audit: audit(),
        }),
      ).rejects.toMatchObject({ status: 403 });
      await db
        .update(utentiTable)
        .set({ areaOperativaId: area })
        .where(eq(utentiTable.id, actor));
      await db
        .update(ruoliTable)
        .set({ aree: [] })
        .where(eq(ruoliTable.id, role));
      await expect(
        downloadFseRepresentation({
          id: exportId,
          originalReason: "Area applicativa mancante",
          audit: audit(),
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await db
        .update(utentiTable)
        .set({ areaOperativaId: area })
        .where(eq(utentiTable.id, actor));
      await db
        .update(ruoliTable)
        .set({ aree: ["magazzino"], permessi: ["magazzino.fse.view"] })
        .where(eq(ruoliTable.id, role));
    }
  });
  it("D28: materialized representation is immutable", async () => {
    const [r] = await db
      .select()
      .from(esportazioniFseRappresentazioniTable)
      .where(eq(esportazioniFseRappresentazioniTable.esportazioneId, exportId));
    await expect(
      pool.query(
        "UPDATE esportazioni_fse_rappresentazioni SET semantic_hash=$1 WHERE id=$2",
        ["0".repeat(64), r.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("D21: revocation while generation waits is enforced even with a cached artifact", async () => {
    const blocker = await pool.connect();
    let pending: Promise<unknown> | undefined;
    await db
      .update(ruoliTable)
      .set({ permessi: ["magazzino.fse.view", FSE_ORIGINAL_PERMISSION] })
      .where(eq(ruoliTable.id, role));
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`fse-representation:${exportId}`],
      );
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0]
        .pid;
      pending = downloadFseRepresentation({
        id: exportId,
        originalReason: "Accesso in attesa sintetico",
        audit: audit(),
      }).then(
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
          throw Error("No PostgreSQL representation barrier");
        await new Promise((r) => setImmediate(r));
      }
      await db
        .update(ruoliTable)
        .set({ permessi: ["magazzino.fse.view"] })
        .where(eq(ruoliTable.id, role));
      await blocker.query("COMMIT");
      expect(await pending).toMatchObject({ error: { status: 403 } });
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_eventi WHERE entita_id=$1 AND motivo=$2",
            [exportId, "Accesso in attesa sintetico"],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
    }
  });
  it("D22: audit failure rolls back a new artifact, without touching the original", async () => {
    const [base] = await db
      .select()
      .from(esportazioniFseTable)
      .where(eq(esportazioniFseTable.id, exportId));
    const [other] = await db
      .insert(esportazioniFseTable)
      .values({
        ...base,
        id: undefined,
        idempotencyKey: canonicalSha256(randomUUID()),
      })
      .returning();
    await pool.query(
      `CREATE FUNCTION test_m64_representation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.azione='FSE_RAPPRESENTAZIONE_MINIMIZZATA_CREATA' AND NEW.entita_id=${other.id} THEN RAISE EXCEPTION 'M64 representation fault'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      "CREATE TRIGGER test_m64_representation_fault BEFORE INSERT ON audit_eventi FOR EACH ROW EXECUTE FUNCTION test_m64_representation_fault()",
    );
    try {
      await expect(
        downloadFseRepresentation({ id: other.id, audit: audit() }),
      ).rejects.toMatchObject({
        cause: { message: "M64 representation fault" },
      });
      expect(
        await db
          .select()
          .from(esportazioniFseRappresentazioniTable)
          .where(
            eq(esportazioniFseRappresentazioniTable.esportazioneId, other.id),
          ),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(esportazioniFseTable)
          .where(eq(esportazioniFseTable.id, other.id)),
      ).toEqual([other]);
    } finally {
      await pool.query(
        "DROP TRIGGER test_m64_representation_fault ON audit_eventi",
      );
      await pool.query("DROP FUNCTION test_m64_representation_fault()");
    }
  });
});
