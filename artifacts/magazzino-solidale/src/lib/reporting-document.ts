import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  ReportDrilldown,
  ReportingDashboard,
  ReportSeries,
} from "@workspace/api-client-react";
import type {
  PdfExportBranding,
  ReportingExportLabels,
  ReportingScopeNames,
} from "./export";
import amiriUrl from "@/assets/reporting/Amiri-Regular.ttf?url";
import {
  reportingFilterRows,
  reportingSeriesLabel,
} from "./reporting-metadata";

export type ReportingDocumentInput = {
  title: string;
  report: ReportingDashboard;
  labels: ReportingExportLabels;
  scopeNames?: ReportingScopeNames;
  branding?: PdfExportBranding | null;
  datasetId: string;
  detail?: ReportDrilldown | null;
};

/** The one document builder used by download and print preview. No screen capture. */
export async function buildReportingPdf(
  input: ReportingDocumentInput,
): Promise<Blob> {
  const { report, labels, datasetId } = input;
  const response = await fetch(amiriUrl);
  if (!response.ok) throw new Error("PDF font unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
    orientation:
      Math.max(
        4,
        ...report.tables.map((table) => table.columns.length),
        input.detail?.columns.length ?? 0,
      ) > 5
        ? "landscape"
        : "portrait",
    putOnlyUsedFonts: true,
  });
  doc.addFileToVFS("Amiri-Regular.ttf", btoa(binary));
  doc.addFont("Amiri-Regular.ttf", "Amiri", "normal");
  doc.setFont("Amiri", "normal");
  // Use the library's Unicode bidi algorithm, not R2L's whole-string reverse:
  // mixed Arabic labels, ISO dates and Latin document IDs must keep their runs.
  doc.internal.events.subscribe(
    "preProcessText",
    (payload: { options: Record<string, unknown> }) => {
      Object.assign(payload.options, {
        R2L: false,
        isInputVisual: false,
        isInputRtl: false,
        isOutputVisual: true,
        isOutputRtl: false,
      });
    },
  );
  doc.setProperties({
    title: input.title,
    subject: `${datasetId} · ${report.reportingModelVersion}`,
    creator: "Magazzino Solidale",
  });
  const rtl = labels.locale.startsWith("ar");
  const margin = 38;
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const bodyWidth = width - margin * 2;
  let y = 46;
  const plain = (value: unknown) =>
    value == null ? labels.unavailable : String(value);
  const write = (value: string, size = 11) => {
    doc.setFontSize(size);
    doc.setR2L(/[\u0600-\u06ff]/.test(value));
    const lines: string[] = doc.splitTextToSize(value, bodyWidth);
    for (const line of lines) {
      if (y > height - 62) {
        doc.addPage();
        y = 46;
      }
      doc.text(line, rtl ? width - margin : margin, y, {
        align: rtl ? "right" : "left",
      });
      y += size * 1.55;
    }
    doc.setR2L(false);
  };
  const table = (title: string, columns: string[], values: unknown[][]) => {
    // Wide tables are split into groups with the first identifying column repeated.
    const groups =
      columns.length <= 6
        ? [columns.map((_, i) => i)]
        : Array.from(
            { length: Math.ceil((columns.length - 1) / 5) },
            (_, index) => [
              0,
              ...columns.map((_, i) => i).slice(1 + index * 5, 6 + index * 5),
            ],
          );
    for (const group of groups) {
      if (y > height - 120) {
        doc.addPage();
        y = 46;
      }
      write(title, 13);
      const indices = rtl ? [...group].reverse() : group;
      autoTable(doc, {
        startY: y,
        margin: { top: 38, right: margin, bottom: 48, left: margin },
        head: [indices.map((i) => columns[i])],
        body: values.length
          ? values.map((row) => indices.map((i) => plain(row[i])))
          : [[`${labels.metadata.rows}: 0`]],
        styles: {
          font: "Amiri",
          fontStyle: "normal",
          fontSize: rtl ? 12 : 10,
          cellPadding: 5,
          overflow: "linebreak",
          halign: rtl ? "right" : "left",
        },
        headStyles: {
          fontStyle: "normal",
          fillColor: [230, 233, 238],
          textColor: 20,
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        rowPageBreak: "avoid",
        showHead: "everyPage",
        willDrawCell: (data) => {
          doc.setR2L(/[\u0600-\u06ff]/.test(data.cell.text.join(" ")));
        },
        didDrawCell: () => {
          doc.setR2L(false);
        },
      });
      y =
        (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
          .finalY + 24;
    }
  };
  if (input.branding?.logoDataUrl) {
    const logo = doc.getImageProperties(input.branding.logoDataUrl);
    const scale = Math.min(120 / logo.width, 52 / logo.height);
    doc.addImage(
      input.branding.logoDataUrl,
      logo.fileType,
      rtl ? width - margin - logo.width * scale : margin,
      y,
      logo.width * scale,
      logo.height * scale,
    );
    y += logo.height * scale + 24;
  }
  write(input.branding?.nomeDocumento || "Magazzino Solidale", 18);
  if (input.branding?.sottotitoloDocumento)
    write(input.branding.sottotitoloDocumento);
  write(input.title, 16);
  if (rtl) {
    // ISO dates/timestamps are LTR identifiers, not locally reformatted dates.
    // Separate their runs from Arabic labels instead of reversing date fields.
    write(`${labels.metadata.from} / ${labels.metadata.to}`);
    write(`${report.filters.da} / ${report.filters.a} · ${report.timezone}`);
    write(labels.metadata.generatedAt);
    write(
      `${report.generatedAt} · ${report.definitionRevision ?? report.reportingModelVersion}`,
    );
  } else {
    write(
      `${labels.metadata.from}: ${report.filters.da} — ${labels.metadata.to}: ${report.filters.a} · ${report.timezone}`,
    );
    write(
      `${labels.metadata.generatedAt}: ${report.generatedAt} · ${report.definitionRevision ?? report.reportingModelVersion}`,
    );
  }
  write(`Dataset: ${datasetId}`);
  for (const [label, value] of reportingFilterRows(
    report,
    labels,
    input.scopeNames,
  ))
    write(`${label}: ${value}`);
  table(
    labels.metadata.indicator,
    [
      labels.metadata.indicator,
      labels.metadata.value,
      labels.metadata.unit,
      labels.metadata.availability,
    ],
    report.kpi.map((item) => [
      labels.kpi(item.key),
      item.exactValue ?? labels.unavailable,
      labels.unit(item.unit),
      `${labels.availability(item.availability)}${item.denominator == null ? "" : ` (${item.numerator}/${item.denominator}; ${item.presentationDecimals} dec.)`}`,
    ]),
  );
  const drawSeries = (series: ReportSeries) => {
    // Separate scales/panels: never put credit and counts on one implicit axis.
    const measures =
      series.secondary || series.points.some((p) => p.secondaryValue != null)
        ? [false, true]
        : [false];
    for (const secondary of measures) {
      const label = reportingSeriesLabel(series, secondary, labels);
      write(label, 11);
      const value = (p: ReportSeries["points"][number]) =>
        secondary ? p.secondaryValue : p.value;
      const max = Math.max(
        1,
        ...series.points.map((p) => Math.abs(value(p) ?? 0)),
      );
      const axis = margin + bodyWidth * 0.56;
      for (const point of series.points) {
        if (y > height - 100) {
          doc.addPage();
          y = 46;
          write(`${labels.table(series.key)} · ${label}`, 11);
        }
        const amount = value(point);
        doc.setFontSize(10);
        doc.setR2L(false);
        const name = doc.splitTextToSize(
          point.label,
          bodyWidth * 0.3,
        ) as string[];
        doc.text(name, margin, y);
        const length = (Math.abs(amount ?? 0) / max) * bodyWidth * 0.2;
        doc.setDrawColor(70);
        doc.line(axis, y - 8, axis, y + 2);
        const gray = secondary ? 175 : 85;
        doc.setFillColor(gray, gray, gray);
        if (amount != null)
          doc.rect(amount < 0 ? axis - length : axis, y - 7, length, 7, "FD");
        const exact = secondary ? point.exactSecondaryValue : point.exactValue;
        const numberText =
          exact ?? (amount == null ? labels.unavailable : String(amount));
        // Values get their own line: large exact decimals must never overlap bars.
        y += Math.max(14, name.length * 13);
        doc.text(numberText, width - margin, y, { align: "right" });
        y += 20;
      }
      y += 10;
    }
  };
  for (const series of report.series) {
    write(labels.table(series.key), 13);
    drawSeries(series);
    table(
      labels.table(series.key),
      [
        labels.column("data"),
        reportingSeriesLabel(series, false, labels),
        reportingSeriesLabel(series, true, labels),
      ],
      series.points.map((point) => [
        point.label,
        point.exactValue ?? point.value,
        point.exactSecondaryValue ?? point.secondaryValue ?? labels.unavailable,
      ]),
    );
  }
  for (const data of report.tables)
    table(
      labels.table(data.key),
      data.columns.map(labels.column),
      data.rows.map((row) =>
        data.columns.map((column) => {
          const value = row[column];
          return typeof value === "string" ? labels.text(value) : value;
        }),
      ),
    );
  if (input.detail)
    table(
      `${labels.table("09_Dettaglio_Controllo")} (${input.detail.total})`,
      input.detail.columns.map(labels.column),
      input.detail.rows.map((row) =>
        input.detail!.columns.map((column) => row[column]),
      ),
    );
  table(
    labels.metadata.notes,
    [
      labels.metadata.indicator,
      labels.metadata.value,
      labels.metadata.availability,
      labels.metadata.notes,
    ],
    report.quality.map((item) => [
      labels.quality(item.key),
      item.count,
      labels.availability(item.availability),
      item.note ? labels.text(item.note) : "",
    ]),
  );
  write(labels.metadata.definitions, 13);
  for (const item of [...(report.excludedSources ?? []), ...report.definitions])
    write(labels.text(item));
  if (report.section === "fse-plus")
    write(
      "FSE+ · EXTERNAL_FORMAT_UNVERIFIED · Reporting di controllo / Control reporting",
    );
  if (input.branding?.footerDocumenti) write(input.branding.footerDocumenti);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setR2L(false);
    doc.setFontSize(9);
    doc.setTextColor(70);
    doc.text(`${page} / ${pages} · ${datasetId}`, margin, height - 23);
  }
  return doc.output("blob");
}
