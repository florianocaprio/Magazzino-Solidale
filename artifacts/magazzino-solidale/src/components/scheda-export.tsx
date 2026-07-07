import { useGetBeneficiario, getGetBeneficiarioQueryKey, useListInterventi, getListInterventiQueryKey, type BeneficiarioDettaglio, type Intervento } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { exportSchedaPdf, exportSchedaXlsx, type SchedaLabelValue, type SchedaSection } from "@/lib/export";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function calcEta(dataNascita?: string | null): number | null {
  if (!dataNascita) return null;
  const d = new Date(dataNascita);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let eta = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) eta--;
  return eta;
}

function fmtDate(v?: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : format(d, "dd/MM/yyyy");
}

function fmtSesso(v: string | null | undefined, t: TFn): string {
  if (v === "M") return t("beneficiarioDettaglio.maschio");
  if (v === "F") return t("beneficiarioDettaglio.femmina");
  if (v === "ALTRO") return t("beneficiarioDettaglio.altro");
  return v ?? "";
}

function buildAnagrafica(b: BeneficiarioDettaglio, t: TFn): SchedaLabelValue[] {
  return [
    { label: t("scheda.codice"), value: b.codice },
    { label: t("common.surname"), value: b.cognome },
    { label: t("common.name"), value: b.nome },
    { label: t("beneficiarioDettaglio.codiceFiscale"), value: b.codiceFiscale },
    { label: t("beneficiarioDettaglio.dataNascita"), value: fmtDate(b.dataNascita) },
    { label: t("beneficiarioDettaglio.sesso"), value: fmtSesso(b.sesso, t) },
    { label: t("beneficiarioDettaglio.cittadinanza"), value: b.cittadinanza },
    { label: t("beneficiarioDettaglio.areaProvenienza"), value: b.areaProvenienza },
    { label: t("beneficiarioDettaglio.residenza"), value: b.residenza },
    { label: t("beneficiarioDettaglio.domicilio"), value: b.domicilio },
    { label: t("beneficiarioDettaglio.comune"), value: b.comune },
    { label: t("beneficiarioDettaglio.zonaMunicipio"), value: b.zonaMunicipio },
    { label: t("common.phone"), value: b.telefono },
    { label: t("common.email"), value: b.email },
    { label: t("scheda.statoCivile"), value: b.statoCivile },
    { label: t("beneficiarioDettaglio.centroRiferimento"), value: b.centroAscoltoNome },
    { label: t("beneficiarioDettaglio.prioritaAssistenziale"), value: b.priorita },
    { label: t("beneficiarioDettaglio.numComponenti"), value: b.numComponenti },
    { label: t("beneficiarioDettaglio.consegnaDomicilio"), value: b.consegnaDomicilio ? t("common.yes") : t("common.no") },
    { label: t("beneficiarioDettaglio.motivoConsegna"), value: b.motivoConsegnaDomicilio },
    { label: t("beneficiarioDettaglio.restrizioniAlimentari"), value: b.restrizioniAlimentari },
    { label: t("scheda.allergie"), value: b.allergie },
    { label: t("scheda.notePaccoAlimentare"), value: b.notePaccoAlimentare },
    { label: t("scheda.dataPresaInCarico"), value: fmtDate(b.dataPresaInCarico) },
    { label: t("scheda.noteInterne"), value: b.noteInterne },
    { label: t("scheda.statoLabel"), value: b.attivo ? t("common.active") : t("common.inactive") },
  ];
}

function buildSections(b: BeneficiarioDettaglio, interventi: Intervento[], t: TFn): SchedaSection[] {
  const nucleo = b.nucleo ?? [];
  return [
    {
      title: t("scheda.nucleoTitolo"),
      headers: [t("common.surname"), t("common.name"), t("scheda.colRelazione"), t("beneficiarioDettaglio.dataNascita"), t("scheda.colEta"), t("beneficiarioDettaglio.sesso"), t("interventi.note")],
      rows: nucleo.map((m) => {
        const eta = calcEta(m.dataNascita);
        return [m.cognome, m.nome, m.relazione, fmtDate(m.dataNascita), eta != null ? `${eta} ${t("scheda.anni")}` : "", fmtSesso(m.sesso, t), m.note];
      }),
      emptyText: t("scheda.nucleoVuoto"),
    },
    {
      title: t("scheda.interventiTitolo"),
      headers: [t("common.date"), t("beneficiarioDettaglio.colTipoIntervento"), t("beneficiarioDettaglio.colDescrizione"), t("beneficiarioDettaglio.colEsito"), t("beneficiarioDettaglio.colProssimaAzione"), t("interventi.note")],
      rows: interventi.map((i) => [fmtDate(i.dataIntervento), i.tipoIntervento, i.descrizione, i.esito, i.prossimAzione, i.note]),
      emptyText: t("scheda.interventiVuoto"),
    },
  ];
}

async function doExport(b: BeneficiarioDettaglio, interventi: Intervento[], kind: "pdf" | "xlsx", t: TFn): Promise<void> {
  const fullName = `${b.cognome} ${b.nome}`;
  const filename = `scheda_${b.cognome}_${b.nome}`.replace(/\s+/g, "_");
  const anagrafica = buildAnagrafica(b, t);
  const sections = buildSections(b, interventi, t);
  if (kind === "pdf") {
    const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
    await exportSchedaPdf({
      filename,
      title: `${t("scheda.titolo")} — ${fullName}`,
      subtitle: b.codice,
      anagraficaTitle: t("scheda.anagraficaTitolo"),
      campoHeader: t("scheda.campo"),
      valoreHeader: t("scheda.valore"),
      anagrafica,
      sections,
      branding: { ...branding, logoDataUrl },
    });
  } else {
    exportSchedaXlsx({
      filename,
      anagraficaSheetName: t("scheda.anagraficaTitolo"),
      campoHeader: t("scheda.campo"),
      valoreHeader: t("scheda.valore"),
      anagrafica,
      sections,
    });
  }
}

export function SchedaExportButtons({ b, size = "sm" }: { b: BeneficiarioDettaglio; size?: "sm" | "default" }) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const { data: interventi, isLoading } = useListInterventi(
    { beneficiarioId: b.id },
    { query: { queryKey: getListInterventiQueryKey({ beneficiarioId: b.id }) } },
  );
  const list = interventi ?? b.interventi ?? [];
  const handleExport = async (kind: "pdf" | "xlsx") => {
    setExporting(true);
    try {
      await doExport(b, list, kind, t);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size={size} className="gap-2" disabled={isLoading || exporting} onClick={() => void handleExport("pdf")}>
        <FileText className="w-4 h-4" /> {t("scheda.schedaPdf")}
      </Button>
      <Button variant="outline" size={size} className="gap-2" disabled={isLoading || exporting} onClick={() => void handleExport("xlsx")}>
        <FileSpreadsheet className="w-4 h-4" /> {t("scheda.schedaXlsx")}
      </Button>
    </>
  );
}

export function SchedaExportDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: b, isLoading } = useGetBeneficiario(id, { query: { queryKey: getGetBeneficiarioQueryKey(id) } });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scheda.esporta")}</DialogTitle>
        </DialogHeader>
        {isLoading || !b ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm font-medium">{b.cognome} {b.nome} <span className="text-muted-foreground font-mono">{b.codice}</span></p>
            <div className="flex gap-2">
              <SchedaExportButtons b={b} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
