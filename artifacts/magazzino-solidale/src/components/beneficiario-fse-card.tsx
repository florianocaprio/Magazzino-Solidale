import { useEffect, useState } from "react";
import {
  getGetBeneficiarioFseQueryKey,
  useGetBeneficiarioFse,
  useUpdateBeneficiarioFse,
  type BeneficiarioFseUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatDateOrDateTimeEuropeRome, todayEuropeRome } from "@/lib/europe-rome";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

const DEMOGRAPHY_ROWS = [
  ["Componenti", "numeroComponenti"],
  ["Donne", "donne"],
  ["Uomini", "uomini"],
  ["0–17", "eta017"],
  ["18–29", "eta1829"],
  ["30–64", "eta3064"],
  ["65+", "eta65Plus"],
] as const;

function formatTimestamp(value: string | null | undefined): string {
  return value ? formatDateOrDateTimeEuropeRome(value) : "Mai";
}

function errorMessage(error: unknown): string {
  return (error as { data?: { error?: string } })?.data?.error ??
    (error instanceof Error ? error.message : "Aggiornamento FSE+ non riuscito.");
}

function formatFseCount(value: number | null | undefined): string {
  return value == null ? "Non valorizzato" : String(value);
}

function fseCountInput(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

export function BeneficiarioFseCard({
  beneficiarioId,
  canManage,
}: {
  beneficiarioId: number;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGetBeneficiarioFse(beneficiarioId);
  const update = useUpdateBeneficiarioFse();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    codiceFascicolo: "",
    origineStranieraMinoranze: "",
    cittadiniPaesiTerzi: "",
    senzaTettoEsclusioneAbitativa: "",
    dataRiferimento: todayEuropeRome(),
  });

  useEffect(() => {
    if (!data?.profilo) {
      setForm({
        codiceFascicolo: "",
        origineStranieraMinoranze: "",
        cittadiniPaesiTerzi: "",
        senzaTettoEsclusioneAbitativa: "",
        dataRiferimento: todayEuropeRome(),
      });
      return;
    }
    setForm({
      codiceFascicolo: data.profilo.codiceFascicolo ?? "",
      origineStranieraMinoranze: fseCountInput(data.profilo.origineStranieraMinoranze),
      cittadiniPaesiTerzi: fseCountInput(data.profilo.cittadiniPaesiTerzi),
      senzaTettoEsclusioneAbitativa: fseCountInput(data.profilo.senzaTettoEsclusioneAbitativa),
      dataRiferimento: data.profilo.dataRiferimento ?? todayEuropeRome(),
    });
  }, [data]);

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>;
  }
  if (isError || !data) {
    return <Card><CardContent className="p-6 text-sm text-destructive">
      {t("reporting.fse.loadError")}
    </CardContent></Card>;
  }

  const profile = data.profilo;
  const detailComplete = data.demografia.dettaglioCompleto;
  const save = async () => {
    const nullableCount = (value: string) => value.trim() === "" ? null : Number(value);
    const payload: BeneficiarioFseUpdate = {
      ...(form.codiceFascicolo.trim() ? { codiceFascicolo: form.codiceFascicolo.trim() } : {}),
      origineStranieraMinoranze: nullableCount(form.origineStranieraMinoranze),
      cittadiniPaesiTerzi: nullableCount(form.cittadiniPaesiTerzi),
      senzaTettoEsclusioneAbitativa: nullableCount(form.senzaTettoEsclusioneAbitativa),
      dataRiferimento: form.dataRiferimento,
      versione: profile?.versione ?? 0,
    };
    try {
      await update.mutateAsync({ id: beneficiarioId, data: payload });
      await queryClient.invalidateQueries({ queryKey: getGetBeneficiarioFseQueryKey(beneficiarioId) });
      setEditing(false);
      toast({ title: t("reporting.fse.updated") });
    } catch (error) {
      toast({ title: t("reporting.fse.dossier"), description: errorMessage(error), variant: "destructive" });
    }
  };

  return <>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-base">{t("reporting.fse.dossier")}</CardTitle>
        {canManage && (
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />{t("reporting.fse.edit")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><span className="text-muted-foreground">Codice fascicolo</span>
            <div className="font-medium">{profile?.codiceFascicolo ?? "Non ancora assegnato"}</div>
          </div>
          <div><span className="text-muted-foreground">Origine</span>
            <div className="font-medium">{profile?.origineFascicolo === "import_fse" ? "Import FSE+" : "Interno"}</div>
          </div>
          <div><span className="text-muted-foreground">Ultimo import</span>
            <div className="font-medium">{formatTimestamp(profile?.ultimoImportAt)}</div>
          </div>
          <div><span className="text-muted-foreground">Ultimo export</span>
            <div className="font-medium">{formatTimestamp(profile?.ultimoExportAt)}</div>
          </div>
          <div><span className="text-muted-foreground">Componenti</span>
            <div className="font-medium">{data.componentiDettagliati}/{data.componentiDichiarati}</div>
          </div>
          <div><span className="text-muted-foreground">Stato nucleo</span>
            <div><Badge variant={detailComplete ? "default" : "secondary"}>
              {detailComplete ? "Anagraficamente completo" : "Incompleto"}
            </Badge></div>
          </div>
          <div><span className="text-muted-foreground">Origine demografia</span>
            <div className="font-medium">
              {data.demografia.origine === "snapshot_fse" ? "Snapshot FSE+" : "Anagrafica calcolata"}
            </div>
          </div>
          <div><span className="text-muted-foreground">Allineamento</span>
            <div><Badge variant={data.confronto.stato === "non_allineato" ? "destructive" : "outline"}>
              {data.confronto.stato === "coerente"
                ? "Fascicolo coerente"
                : data.confronto.stato === "non_allineato"
                  ? "Non allineato"
                  : "Non confrontabile"}
            </Badge></div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>Origine/minoranze: <strong>{formatFseCount(profile?.origineStranieraMinoranze)}</strong></div>
          <div>Paesi terzi: <strong>{formatFseCount(profile?.cittadiniPaesiTerzi)}</strong></div>
          <div>Esclusione abitativa: <strong>{formatFseCount(profile?.senzaTettoEsclusioneAbitativa)}</strong></div>
          <div>Disabili: <strong>{data.disabili}</strong></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-2">Dato</th>
                <th>Snapshot FSE+</th>
                <th>Calcolato/effettivo</th>
              </tr>
            </thead>
            <tbody>
              {DEMOGRAPHY_ROWS.map(([label, key]) => {
                const different = data.snapshot != null && detailComplete &&
                  data.snapshot[key] !== data.demografia[key];
                return <tr key={key} className={different ? "bg-destructive/10" : "border-b"}>
                  <td className="py-2">{label}</td>
                  <td>{data.snapshot?.[key] ?? "—"}</td>
                  <td>{data.demografia[key]}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {data.confronto.differenze.length > 0 && (
          <div className="rounded border border-destructive/40 p-3 text-destructive">
            Differenze: {data.confronto.differenze
              .map((difference) => `${difference.dato} ${difference.snapshot}→${difference.calcolato}`)
              .join(", ")}
          </div>
        )}
        {data.demografia.problemi.length > 0 && (
          <div className="rounded border border-amber-400/60 p-3 text-amber-800">
            Dati da completare: {data.demografia.problemi.join(", ")}
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={editing} onOpenChange={setEditing}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("reporting.fse.edit")} {t("reporting.fse.dossier")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label htmlFor="fse-reference-date">{t("reporting.fse.dossierReferenceDate")}</Label>
            <Input id="fse-reference-date" type="date" value={form.dataRiferimento}
              onChange={(event) => setForm({ ...form, dataRiferimento: event.target.value })} />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("reporting.fse.referenceDateHistory")}
            </p>
          </div>
          <div><Label htmlFor="fse-code">Codice fascicolo</Label>
            <Input id="fse-code" value={form.codiceFascicolo}
              onChange={(event) => setForm({ ...form, codiceFascicolo: event.target.value })} />
          </div>
          {([
            ["origineStranieraMinoranze", "Origine straniera e minoranze"],
            ["cittadiniPaesiTerzi", "Cittadini di Paesi Terzi"],
            ["senzaTettoEsclusioneAbitativa", "Esclusione abitativa"],
          ] as const).map(([key, label]) => (
            <div key={key}><Label htmlFor={`fse-${key}`}>{label}</Label>
              <Input id={`fse-${key}`} type="number" min={0} max={data.componentiDichiarati}
                placeholder={t("reporting.fse.notSet")}
                value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditing(false)}>{t("reporting.fse.cancel")}</Button>
          <Button onClick={() => void save()} disabled={update.isPending}>
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
