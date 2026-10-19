import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSuperAdminConfigurazioneCodiciBeneficiari,
  useUpdateSuperAdminConfigurazioneCodiciBeneficiari,
  getGetSuperAdminConfigurazioneCodiciBeneficiariQueryKey,
  type ConfigurazioneCodiciBeneficiariInput,
} from "@workspace/api-client-react";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";

type CodeForm = Omit<
  ConfigurazioneCodiciBeneficiariInput,
  "prefissoAssociazione" | "segmentoFisso"
> & { prefissoAssociazione: string; segmentoFisso: string };
export function ConfigurazioneCodiciBeneficiari() {
  const { toast } = useToast();
  const client = useQueryClient();
  const query = useGetSuperAdminConfigurazioneCodiciBeneficiari();
  const [form, setForm] = useState<CodeForm>({
    prefissoAssociazione: "BEN",
    includiCodiceArea: false,
    segmentoFisso: "",
    separatore: "-",
    cifreProgressivo: 6,
    numeroIniziale: 1,
    ambitoProgressivo: "GLOBALE",
  });
  useEffect(() => {
    const c = query.data?.configurazione;
    if (c)
      setForm({
        prefissoAssociazione: c.prefissoAssociazione ?? "",
        includiCodiceArea: c.includiCodiceArea,
        segmentoFisso: c.segmentoFisso ?? "",
        separatore: c.separatore,
        cifreProgressivo: c.cifreProgressivo,
        numeroIniziale: c.numeroIniziale,
        ambitoProgressivo: c.ambitoProgressivo,
      });
  }, [query.data]);
  const update = useUpdateSuperAdminConfigurazioneCodiciBeneficiari({
    mutation: {
      onSuccess: () => {
        client.invalidateQueries({
          queryKey: getGetSuperAdminConfigurazioneCodiciBeneficiariQueryKey(),
        });
        toast({ title: "Configurazione codici beneficiari salvata" });
      },
      onError: (error) =>
        toast({
          title: "Configurazione non salvata",
          description: errorMessage(error, "Controlla i valori inseriti"),
          variant: "destructive",
        }),
    },
  });
  const example = [
    form.prefissoAssociazione.trim().toUpperCase(),
    form.includiCodiceArea ? "RM" : "",
    form.segmentoFisso.trim().toUpperCase(),
    String(form.numeroIniziale).padStart(
      Math.min(8, Math.max(2, form.cifreProgressivo || 2)),
      "0",
    ),
  ]
    .filter(Boolean)
    .join(form.separatore);
  const save = () =>
    update.mutate({
      data: {
        ...form,
        prefissoAssociazione: form.prefissoAssociazione.trim() || null,
        segmentoFisso: form.segmentoFisso.trim() || null,
      },
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Codici automatici beneficiari</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Configurazione non disponibile. Riprova a caricare la pagina.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          La regola si applica ai nuovi beneficiari con codice lasciato vuoto,
          anche negli import. Ogni salvataggio crea una versione auditata. I
          codici già assegnati non cambiano. Il codice anagrafico viene stampato
          sulla tessera; QR e lettore conservano la tessera registrata.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="benef-code-prefissoAssociazione">
              Prefisso associazione
            </Label>
            <Input
              maxLength={12}
              id="benef-code-prefissoAssociazione"
              value={form.prefissoAssociazione}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  prefissoAssociazione: event.target.value.toUpperCase(),
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="benef-code-segmentoFisso">Segmento fisso</Label>
            <Input
              maxLength={8}
              id="benef-code-segmentoFisso"
              value={form.segmentoFisso}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  segmentoFisso: event.target.value.toUpperCase(),
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="benef-code-separatore">Separatore</Label>
            <Select
              value={form.separatore || "NESSUNO"}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  separatore: value === "NESSUNO" ? "" : (value as "-" | "/"),
                }))
              }
            >
              <SelectTrigger id="benef-code-separatore">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NESSUNO">Nessuno</SelectItem>
                <SelectItem value="-">Trattino (-)</SelectItem>
                <SelectItem value="/">Barra (/)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="benef-code-cifreProgressivo">
              Cifre progressivo
            </Label>
            <Input
              type="number"
              min={2}
              max={8}
              id="benef-code-cifreProgressivo"
              value={form.cifreProgressivo}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  cifreProgressivo: Number(event.target.value),
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="benef-code-numeroIniziale">Numero iniziale</Label>
            <Input
              type="number"
              min={1}
              id="benef-code-numeroIniziale"
              value={form.numeroIniziale}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  numeroIniziale: Number(event.target.value),
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="benef-code-ambito">Ambito progressivo</Label>
            <Select
              value={form.ambitoProgressivo}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  ambitoProgressivo: value as "GLOBALE" | "PER_AREA",
                }))
              }
            >
              <SelectTrigger id="benef-code-ambito">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PER_AREA">Separato per Area</SelectItem>
                <SelectItem value="GLOBALE">Globale</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="benef-code-area">Includi codice Area</Label>
            <p className="text-sm text-muted-foreground">
              Codice configurato sull’Area; in assenza viene usata la sigla.
            </p>
          </div>
          <Switch
            id="benef-code-area"
            checked={form.includiCodiceArea}
            onCheckedChange={(checked) =>
              setForm((current) => ({
                ...current,
                includiCodiceArea: checked,
              }))
            }
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted p-3">
          <div className="text-sm">
            Anteprima (Area RM): <strong>{example}</strong>
          </div>
          <Button onClick={save} disabled={update.isPending || !query.data}>
            {update.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salva nuova versione
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Versione attiva: {query.data?.configurazione?.versione ?? "—"}.
          Versioni conservate: {query.data?.storico?.length ?? 0}. Lunghezza
          massima: 20 caratteri, includendo fino a 8 caratteri per il codice
          Area.
        </p>
      </CardContent>
    </Card>
  );
}
