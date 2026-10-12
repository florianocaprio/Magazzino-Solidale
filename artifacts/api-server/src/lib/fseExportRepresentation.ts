import { createHash } from "node:crypto";
import {
  db,
  esportazioniFseTable,
  esportazioniFseRappresentazioniTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  auditFields,
  auditUserId,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";
import { requireCurrentFseWarehouse } from "./fseAccess";
import { FseReportingError, isFseFormat } from "./fseCanonicalReporting";
import { FSE_MINIMIZATION_VERSION } from "./fseExportMinimization";
import { generateFseExportWorkbook } from "./fseExportWorkbook";
import { FSE_ORIGINAL_PERMISSION } from "./permissions";

const bytesHash = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

export async function downloadFseRepresentation(input: {
  id: number;
  format?: string;
  originalReason?: string;
  audit: AuditCommandContext;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-representation:${input.id}`},0))`,
    );
    const [header] = await tx
      .select()
      .from(esportazioniFseTable)
      .where(eq(esportazioniFseTable.id, input.id))
      .for("share");
    if (!header) throw new FseReportingError(404, "Esportazione non trovata");
    const original = input.originalReason !== undefined;
    const actor = await requireCurrentFseWarehouse(
      tx,
      auditUserId(input.audit),
      original ? FSE_ORIGINAL_PERMISSION : "magazzino.fse.view",
      header.magazzinoId,
      { historicalRead: true },
    );
    if (
      original &&
      (!(actor.permessi ?? []).includes(FSE_ORIGINAL_PERMISSION) ||
        !(actor.aree ?? []).some(
          (area) => area === "magazzino" || area === "analisi",
        ))
    )
      throw new FseReportingError(
        403,
        "Capacità esplicita per originali FSE non disponibile",
      );
    if (original && !input.originalReason!.trim())
      throw new FseReportingError(400, "Motivo accesso obbligatorio");
    const format = input.format ?? header.formatCode;
    if (!isFseFormat(format))
      throw new FseReportingError(400, "Formato non valido");
    if (original) {
      const result = await generateFseExportWorkbook(input.id, format, {
        executor: tx,
        original: true,
      });
      await recordAuditEvent(tx, {
        command: input.audit,
        azione: "FSE_ORIGINALE_CONSULTATO",
        entitaTipo: "esportazione_fse",
        entitaId: header.id,
        magazzinoIdSnapshot: header.magazzinoId,
        motivo: input.originalReason!.trim(),
        metadata: auditFields(
          {
            originalSnapshotHash: header.canonicalHash,
            format,
            variant: "STORICO_RIGENERATO_NON_MINIMIZZATO",
          },
          ["originalSnapshotHash", "format", "variant"],
        ),
      });
      return {
        ...result,
        artifactHash: bytesHash(result.buffer),
        variant: "STORICO_RIGENERATO_NON_MINIMIZZATO",
        representationId: null,
      };
    }
    const [existing] = await tx
      .select()
      .from(esportazioniFseRappresentazioniTable)
      .where(
        and(
          eq(esportazioniFseRappresentazioniTable.esportazioneId, header.id),
          eq(esportazioniFseRappresentazioniTable.formatCode, format),
          eq(
            esportazioniFseRappresentazioniTable.transformationVersion,
            FSE_MINIMIZATION_VERSION,
          ),
        ),
      );
    const filename = `fse-${header.id}-${format}-${FSE_MINIMIZATION_VERSION}.xlsx`;
    if (existing) {
      const buffer = Buffer.from(existing.artifactBase64, "base64");
      if (
        bytesHash(buffer) !== existing.artifactHash ||
        existing.originalSnapshotHash !== header.canonicalHash
      )
        throw new FseReportingError(
          409,
          "Integrità rappresentazione FSE non verificata",
        );
      return {
        buffer,
        filename,
        artifactHash: existing.artifactHash,
        semanticHash: existing.semanticHash,
        variant: FSE_MINIMIZATION_VERSION,
        representationId: existing.id,
      };
    }
    const result = await generateFseExportWorkbook(input.id, format, {
      executor: tx,
    });
    const artifactHash = bytesHash(result.buffer);
    const [created] = await tx
      .insert(esportazioniFseRappresentazioniTable)
      .values({
        esportazioneId: header.id,
        originalSnapshotHash: header.canonicalHash,
        formatCode: format,
        transformationVersion: FSE_MINIMIZATION_VERSION,
        semanticHash: result.semanticHash,
        artifactHash,
        artifactBase64: result.buffer.toString("base64"),
        creatoDa: actor.id,
      })
      .returning();
    await recordAuditEvent(tx, {
      command: input.audit,
      azione: "FSE_RAPPRESENTAZIONE_MINIMIZZATA_CREATA",
      entitaTipo: "esportazione_fse",
      entitaId: header.id,
      magazzinoIdSnapshot: header.magazzinoId,
      metadata: auditFields(
        {
          representationId: created.id,
          originalSnapshotHash: header.canonicalHash,
          semanticHash: result.semanticHash,
          artifactHash,
          format,
          version: FSE_MINIMIZATION_VERSION,
        },
        [
          "representationId",
          "originalSnapshotHash",
          "semanticHash",
          "artifactHash",
          "format",
          "version",
        ],
      ),
    });
    return {
      ...result,
      filename,
      artifactHash,
      variant: FSE_MINIMIZATION_VERSION,
      representationId: created.id,
    };
  });
}
