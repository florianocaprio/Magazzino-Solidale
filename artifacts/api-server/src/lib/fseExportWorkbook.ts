import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseRigheTable,
  esportazioniFseTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  FSE_CANONICAL_FORMAT,
  FSE_OBSERVED_CONTROL_FORMAT,
} from "./fseCanonicalReporting";

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

export async function generateFseExportWorkbook(exportId: number): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const [header] = await db
    .select()
    .from(esportazioniFseTable)
    .where(eq(esportazioniFseTable.id, exportId));
  if (!header) throw new Error("Esportazione non trovata");
  const events = await db
    .select()
    .from(esportazioniFseEventiTable)
    .where(eq(esportazioniFseEventiTable.esportazioneId, exportId))
    .orderBy(esportazioniFseEventiTable.id);
  const lines = await db
    .select({ line: esportazioniFseRigheTable, event: esportazioniFseEventiTable })
    .from(esportazioniFseRigheTable)
    .innerJoin(
      esportazioniFseEventiTable,
      eq(
        esportazioniFseRigheTable.esportazioneEventoId,
        esportazioniFseEventiTable.id,
      ),
    )
    .where(eq(esportazioniFseEventiTable.esportazioneId, exportId))
    .orderBy(esportazioniFseRigheTable.id);
  const workbook = XLSX.utils.book_new();
  addSheet(workbook, "Metadati", [
    { chiave: "Magazzino", valore: header.magazzinoId },
    { chiave: "Periodo", valore: `${header.dataDa} / ${header.dataA}` },
    { chiave: "Data as-of", valore: header.dataAsOf },
    { chiave: "Timezone", valore: header.timezone },
    { chiave: "modelVersion", valore: header.modelVersion },
    { chiave: "formatCode", valore: header.formatCode },
    { chiave: "maxMovimentoId", valore: header.maxMovimentoId },
    {
      chiave: "maxOperazioneDistribuzioneId",
      valore: header.maxOperazioneDistribuzioneId,
    },
    { chiave: "canonicalHash", valore: header.canonicalHash },
    {
      chiave: "Avvertenza formato",
      valore:
        header.formatCode === FSE_OBSERVED_CONTROL_FORMAT
          ? "NON È UN FORMATO UFFICIALE DI UPLOAD SIFEAD"
          : "Formato canonico interno di audit; nessuna trasmissione automatica",
    },
  ]);

  if (header.formatCode === FSE_OBSERVED_CONTROL_FORMAT) {
    const dynamicPieces = `Giacenza finale pezzi al ${header.dataAsOf}`;
    const dynamicKgLt = `Giacenza finale al ${header.dataAsOf}`;
    const observed = lines.map(({ line, event }) => ({
      Fondo: line.fund === "FSE_PLUS" ? "FSE+" : line.fund,
      Prodotto: line.productNameSnapshot,
      [dynamicPieces]: null,
      [dynamicKgLt]: null,
      "Numero documento": event.documentNumber,
      "Data documento": event.eventDate,
      "Data carico magazzino": null,
      Lotto: line.lotCodeSnapshot,
      "Mittente / destinatario": null,
      "Carico / scarico": line.quantityKgLtSigned,
      "Carico / scarico pezzi": line.quantityPiecesSigned,
      "Giacenza pezzi alla movimentazione": null,
      "Giacenza alla movimentazione": null,
      Note: "Proiezione locale di controllo",
      "Attività": event.officialActivity,
      Pacchi: event.packs,
      Pasti: event.meals,
      "Indigenti saltuari": event.occasionalPeople,
      "Indigenti continuativi": event.continuousPeople,
    }));
    addSheet(workbook, "Registro controllo", observed);
  } else if (header.formatCode === FSE_CANONICAL_FORMAT) {
    addSheet(workbook, "Eventi", events);
    addSheet(
      workbook,
      "Righe prodotto-lotto",
      lines.map(({ line, event }) => ({
        ...line,
        esportazioneEventoId: undefined,
        eventKey: event.eventKey,
      })),
    );
    const byDisposition = (value: string) =>
      lines
        .filter(({ line }) => line.reportingDisposition === value)
        .map(({ line, event }) => ({ eventKey: event.eventKey, ...line }));
    addSheet(workbook, "Carichi", byDisposition("GIA_PRESENTE_REGISTRO_ESTERNO"));
    addSheet(workbook, "Distribuzioni", byDisposition("DA_RENDICONTARE_DDC"));
    addSheet(
      workbook,
      "Storni",
      lines.filter(({ line }) => line.accountingNature === "STORNO").map(({ line, event }) => ({ eventKey: event.eventKey, ...line })),
    );
    addSheet(workbook, "Resi", byDisposition("RESO_OPC"));
    addSheet(workbook, "Modifiche giacenza", byDisposition("MODIFICA_GIACENZA"));
    addSheet(workbook, "Trasferimenti audit", byDisposition("SOLO_AUDIT_TRASFERIMENTO"));
    addSheet(workbook, "Saldi as-of", [], ["magazzinoId", "fondo", "productId", "lotId", "pieces", "kgLt"]);
    addSheet(workbook, "Indicatori", [], ["annoMese", "canale", "indicatore", "valore"]);
    addSheet(
      workbook,
      "Qualità",
      [
        ...events.flatMap((event) =>
          event.qualityCodesJson.map((code) => ({ tipo: "evento", key: event.eventKey, code })),
        ),
        ...lines.flatMap(({ line }) =>
          line.qualityCodesJson.map((code) => ({ tipo: "riga", key: line.lineKey, code })),
        ),
      ],
    );
  } else {
    throw new Error("Formato esportazione non supportato");
  }
  const output = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;
  return {
    buffer: output,
    filename: `rendicontazione-fse-${header.magazzinoId}-${header.dataDa}-${header.dataA}.xlsx`,
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
