import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseIndicatoriTable,
  esportazioniFseRigheTable,
  esportazioniFseSaldiTable,
  esportazioniFseTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  FSE_CANONICAL_FORMAT,
  FSE_OBSERVED_CONTROL_FORMAT,
  isFseFormat,
} from "./fseCanonicalReporting";
import { InventoryDecimal } from "./inventoryDecimal";

export const FSE_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function safeExcelText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function safeRecord(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      Array.isArray(value) || (value != null && typeof value === "object")
        ? safeExcelText(JSON.stringify(value))
        : safeExcelText(value),
    ]),
  );
}

function addSheet(
  workbook: XLSX.WorkBook,
  name: string,
  rows: Array<Record<string, unknown>>,
  headers?: string[],
) {
  const sheet = XLSX.utils.json_to_sheet(rows.map(safeRecord), {
    header: headers,
  });
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

/** Produce soltanto rappresentazioni dello snapshot persistito. */
export async function generateFseExportWorkbook(
  exportId: number,
  requestedFormat?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const [header] = await db
    .select()
    .from(esportazioniFseTable)
    .where(eq(esportazioniFseTable.id, exportId));
  if (!header) throw new Error("Esportazione non trovata");
  const formatCode = requestedFormat ?? header.formatCode;
  if (!isFseFormat(formatCode))
    throw new Error("Formato esportazione non supportato");

  const [events, joinedLines, indicators, balances] = await Promise.all([
    db
      .select()
      .from(esportazioniFseEventiTable)
      .where(eq(esportazioniFseEventiTable.esportazioneId, exportId))
      .orderBy(esportazioniFseEventiTable.id),
    db
      .select({
        line: esportazioniFseRigheTable,
        event: esportazioniFseEventiTable,
      })
      .from(esportazioniFseRigheTable)
      .innerJoin(
        esportazioniFseEventiTable,
        eq(
          esportazioniFseRigheTable.esportazioneEventoId,
          esportazioniFseEventiTable.id,
        ),
      )
      .where(eq(esportazioniFseEventiTable.esportazioneId, exportId))
      .orderBy(esportazioniFseRigheTable.id),
    db
      .select()
      .from(esportazioniFseIndicatoriTable)
      .where(eq(esportazioniFseIndicatoriTable.esportazioneId, exportId))
      .orderBy(
        esportazioniFseIndicatoriTable.annoMese,
        esportazioniFseIndicatoriTable.canaleUfficiale,
      ),
    db
      .select()
      .from(esportazioniFseSaldiTable)
      .where(eq(esportazioniFseSaldiTable.esportazioneId, exportId))
      .orderBy(
        esportazioniFseSaldiTable.prodottoId,
        esportazioniFseSaldiTable.lottoId,
      ),
  ]);

  const metadata = header.snapshotMetadataJson ?? {};
  const workbook = XLSX.utils.book_new();
  addSheet(workbook, "Metadati", [
    {
      chiave: "Magazzino",
      valore: metadata.magazzinoNome ?? header.magazzinoId,
    },
    {
      chiave: "Area Operativa",
      valore: metadata.areaOperativaNome ?? null,
    },
    { chiave: "Periodo", valore: `${header.dataDa} / ${header.dataA}` },
    { chiave: "Data as-of", valore: header.dataAsOf },
    { chiave: "Timezone", valore: header.timezone },
    { chiave: "modelVersion", valore: header.modelVersion },
    { chiave: "formatCode", valore: formatCode },
    { chiave: "maxMovimentoId", valore: header.maxMovimentoId },
    {
      chiave: "maxOperazioneDistribuzioneId",
      valore: header.maxOperazioneDistribuzioneId,
    },
    { chiave: "canonicalHash", valore: header.canonicalHash },
    { chiave: "Data generazione", valore: header.dataCreazione },
    { chiave: "Utente generatore ID", valore: header.creatoDa },
    {
      chiave: "Avvertenza formato",
      valore:
        formatCode === FSE_OBSERVED_CONTROL_FORMAT
          ? "NON È UN FORMATO UFFICIALE DI UPLOAD SIFEAD"
          : "Formato canonico interno di audit; nessuna trasmissione automatica",
    },
  ]);

  if (formatCode === FSE_OBSERVED_CONTROL_FORMAT) {
    const finalBalances = new Map(
      balances.map((balance) => [
        `${balance.prodottoId}:${balance.lottoId ?? ""}`,
        balance,
      ]),
    );
    const progressivePieces = new Map<string, number>();
    const progressiveKgLt = new Map<string, number>();
    const seenEvents = new Set<number>();
    const dynamicPieces = `Giacenza finale pezzi al ${header.dataAsOf}`;
    const dynamicKgLt = `Giacenza finale al ${header.dataAsOf}`;
    const observed = joinedLines.map(({ line, event }) => {
      const key = `${line.productId}:${line.lotId ?? ""}`;
      const pieces =
        (progressivePieces.get(key) ?? 0) +
        Number(line.quantityPiecesSigned ?? 0);
      const kgLt =
        (progressiveKgLt.get(key) ?? 0) + Number(line.quantityKgLtSigned ?? 0);
      progressivePieces.set(key, pieces);
      progressiveKgLt.set(key, kgLt);
      const balance = finalBalances.get(key);
      const firstEventLine = !seenEvents.has(event.id);
      seenEvents.add(event.id);
      const source = line.sourceLineageJson ?? {};
      return {
        Fondo: line.fund === "FSE_PLUS" ? "FSE+" : line.fund,
        Prodotto: line.productNameSnapshot,
        [dynamicPieces]: balance?.saldoPezzi ?? null,
        [dynamicKgLt]: balance?.saldoKgLt ?? null,
        "Numero documento": event.documentNumber,
        "Data documento": event.eventDate,
        "Data carico magazzino": source.loadDateSnapshot ?? null,
        Lotto: line.lotCodeSnapshot,
        "Mittente / destinatario": source.sourceDestinationSnapshot ?? null,
        "Carico / scarico": line.quantityKgLtSigned,
        "Carico / scarico pezzi": line.quantityPiecesSigned,
        "Giacenza pezzi alla movimentazione": pieces.toString(),
        "Giacenza alla movimentazione": kgLt.toString(),
        Note: firstEventLine
          ? "Proiezione locale di controllo; statistiche evento esposte una sola volta"
          : "Proiezione locale di controllo; statistiche evento sulla prima riga",
        Attività: event.officialActivity,
        Pacchi: firstEventLine ? event.packs : null,
        Pasti: firstEventLine ? event.meals : null,
        "Indigenti saltuari": firstEventLine ? event.occasionalPeople : null,
        "Indigenti continuativi": firstEventLine
          ? event.continuousPeople
          : null,
      };
    });
    addSheet(workbook, "Registro controllo", observed);
  } else if (formatCode === FSE_CANONICAL_FORMAT) {
    const immutableEvents = events.map(
      ({
        activeCoverage: _activeCoverage,
        coveredAt: _coveredAt,
        administrativeStatus: _administrativeStatus,
        ...event
      }) => event,
    );
    const immutableLines = joinedLines.map(({ line, event }) => {
      const { activeCoverage: _activeCoverage, ...snapshotLine } = line;
      return { eventKey: event.eventKey, ...snapshotLine };
    });
    addSheet(workbook, "Eventi", immutableEvents);
    addSheet(workbook, "Righe prodotto-lotto", immutableLines);
    const byDisposition = (value: string) =>
      immutableLines.filter((line) => line.reportingDisposition === value);
    addSheet(
      workbook,
      "Carichi",
      byDisposition("GIA_PRESENTE_REGISTRO_ESTERNO"),
    );
    addSheet(workbook, "Distribuzioni", byDisposition("DA_RENDICONTARE_DDC"));
    addSheet(
      workbook,
      "Storni",
      immutableLines.filter((line) => line.accountingNature === "STORNO"),
    );
    addSheet(workbook, "Resi", byDisposition("RESO_OPC"));
    addSheet(
      workbook,
      "Modifiche giacenza",
      byDisposition("MODIFICA_GIACENZA"),
    );
    addSheet(
      workbook,
      "Trasferimenti audit",
      byDisposition("SOLO_AUDIT_TRASFERIMENTO"),
    );
    addSheet(
      workbook,
      "Saldi as-of",
      balances.map((balance) => ({
        magazzinoId: balance.magazzinoId,
        fondo: balance.fondo,
        productId: balance.prodottoId,
        lotId: balance.lottoId,
        pieces:
          balance.saldoPezzi == null
            ? null
            : InventoryDecimal.parse(balance.saldoPezzi, {
                allowNegative: true,
              }).toDb(),
        kgLt:
          balance.saldoKgLt == null
            ? null
            : InventoryDecimal.parse(balance.saldoKgLt, {
                allowNegative: true,
              }).toDb(),
      })),
    );
    addSheet(
      workbook,
      "Indicatori",
      indicators.map((indicator) => ({
        annoMese: indicator.annoMese,
        canale: indicator.canaleUfficiale,
        dataRiferimento: indicator.dataRiferimento,
        ...indicator.valuesJson,
      })),
    );
    addSheet(workbook, "Qualità", [
      ...events.flatMap((event) =>
        event.qualityCodesJson.map((code) => ({
          tipo: "evento",
          key: event.eventKey,
          code,
        })),
      ),
      ...joinedLines.flatMap(({ line }) =>
        line.qualityCodesJson.map((code) => ({
          tipo: "riga",
          key: line.lineKey,
          code,
        })),
      ),
    ]);
  }

  const output = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;
  return {
    buffer: output,
    filename: `rendicontazione-fse-${header.magazzinoId}-${header.dataDa}-${header.dataA}-${formatCode}.xlsx`,
  };
}

export async function exportBelongsToWarehouse(
  exportId: number,
  magazzinoId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: esportazioniFseTable.id })
    .from(esportazioniFseTable)
    .where(
      and(
        eq(esportazioniFseTable.id, exportId),
        eq(esportazioniFseTable.magazzinoId, magazzinoId),
      ),
    );
  return Boolean(row);
}
