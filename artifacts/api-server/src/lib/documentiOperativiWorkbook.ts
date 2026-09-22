import * as XLSX from "xlsx";

export const DOCUMENTI_OPERATIVI_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type DocumentoOperativoExportRow = {
  documentoId: string;
  tipoAggregato: string;
  numero: string;
  dataDocumento: string;
  tipoDestinatario: string;
  destinatarioNome: string | null;
  origineNome: string | null;
  destinazioneMagazzinoNome: string | null;
  stato: string;
  versione: number;
};

const HEADERS = [
  "Identità",
  "Tipo documento",
  "Numero",
  "Data documento",
  "Tipo destinatario",
  "Destinatario",
  "Origine",
  "Destinazione",
  "Stato",
  "Versione",
] as const;

/** Costruisce l'export della facciata comune senza campi logistici o note. */
export function buildDocumentiOperativiWorkbook(
  rows: DocumentoOperativoExportRow[],
): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    [...HEADERS],
    ...rows.map((row) => [
      row.documentoId,
      row.tipoAggregato,
      row.numero,
      row.dataDocumento,
      row.tipoDestinatario,
      row.destinatarioNome ?? "",
      row.origineNome ?? "",
      row.destinazioneMagazzinoNome ?? "",
      row.stato,
      row.versione,
    ]),
  ]);
  sheet["!cols"] = [
    { wch: 24 },
    { wch: 18 },
    { wch: 22 },
    { wch: 16 },
    { wch: 20 },
    { wch: 32 },
    { wch: 28 },
    { wch: 28 },
    { wch: 20 },
    { wch: 10 },
  ];
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address] as XLSX.CellObject;
    if (typeof cell.v === "string") {
      cell.t = "s";
      cell.z = "@";
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Documenti operativi");
  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}
