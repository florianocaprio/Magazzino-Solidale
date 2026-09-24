import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { RientroTrasportoDettaglio } from "@workspace/api-client-react";

/** Printable view of the immutable return rows, including zero-effect anomalies. */
export function generateTransportReturnPdf(
  detail: RientroTrasportoDettaglio,
  documentNumber: string,
  translate: (key: string) => string,
  documentIndex?: number,
) {
  const documents =
    documentIndex == null
      ? (detail.documenti ?? [])
      : (detail.documenti ?? []).slice(documentIndex, documentIndex + 1);
  if (documents.length === 0) return;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setFontSize(16);
  pdf.text(
    documentIndex == null
      ? translate("transportReturn.documentTitle")
      : translate(`transportReturn.document.${documents[0].tipo}`),
    14,
    18,
  );
  pdf.setFontSize(10);
  pdf.text(
    `${translate("transportReturn.originalDocument")}: ${documentNumber}`,
    14,
    27,
  );
  pdf.text(
    `${translate("transportReturn.originWarehouse")}: #${detail.magazzinoOrigineId}`,
    14,
    33,
  );
  pdf.text(
    `${translate("transportReturn.returnDate")}: ${detail.dataRientro ?? "—"}`,
    14,
    39,
  );
  autoTable(pdf, {
    startY: 46,
    head: [
      [
        translate("transportReturn.product"),
        translate("transportReturn.lot"),
        translate("transportReturn.outcome"),
        translate("transportReturn.quantity"),
        translate("transportReturn.reference"),
      ],
    ],
    body: documents.map((row) => {
      const part = detail.partite.find(
        (candidate) => candidate.movimentoUscitaId === row.movimentoUscitaId,
      );
      return [
        part?.prodottoNome ?? `#${row.prodottoId}`,
        part?.codiceLotto || `#${row.lottoId}`,
        translate(`transportReturn.document.${row.tipo}`),
        row.quantita,
        row.scaricoId != null
          ? `#${row.scaricoId}`
          : `#${row.movimentoUscitaId}`,
      ];
    }),
    styles: { fontSize: 9 },
  });
  const suffix =
    documentIndex == null
      ? ""
      : `-${documents[0].tipo}-${documents[0].movimentoUscitaId}`;
  pdf.save(`rientro-${documentNumber.replace(/[^\w-]/g, "_")}${suffix}.pdf`);
}
