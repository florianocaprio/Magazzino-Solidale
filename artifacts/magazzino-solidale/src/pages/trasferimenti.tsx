import { useState } from "react";
import { useListTrasferimenti, useCreateTrasferimento, useAvviaTrasferimento, useConfermaTrasferimento, useListMagazzini, useListProdotti, getListTrasferimentiQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, ArrowRight, ArrowRightLeft, Play, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";

export default function Trasferimenti() {
  const { data: trasferimenti, isLoading } = useListTrasferimenti();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const avviaTrasferimento = useAvviaTrasferimento();
  const confermaTrasferimento = useConfermaTrasferimento();

  const handleAction = (t: any) => {
    if (t.stato === 'richiesto' || t.stato === 'preparato') {
      avviaTrasferimento.mutate({ id: t.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTrasferimentiQueryKey() });
          toast({ title: "Trasferimento avviato" });
        }
      });
    } else if (t.stato === 'in_transito') {
      confermaTrasferimento.mutate({ id: t.id, data: { dataConferma: new Date().toISOString() } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTrasferimentiQueryKey() });
          toast({ title: "Ricezione confermata" });
        }
      });
    }
  };

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'richiesto': return <Badge variant="secondary" className="bg-gray-100 text-gray-800">Richiesto</Badge>;
      case 'preparato': return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Preparato</Badge>;
      case 'in_transito': return <Badge variant="outline" className="bg-amber-500 text-white border-amber-600 shadow-sm animate-pulse">In Transito</Badge>;
      case 'completato': return <Badge variant="outline" className="bg-green-500/10 text-green-700 border-none">Completato</Badge>;
      case 'annullato': return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Annullato</Badge>;
      default: return <Badge>{stato}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trasferimenti</h1>
          <p className="text-muted-foreground">Sposta merce tra i diversi magazzini dell'associazione.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={trasferimenti ?? []}
            columns={[
              { header: "Codice", accessor: (t) => t.codice },
              { header: "Data Richiesta", accessor: (t) => t.dataRichiesta ? new Date(t.dataRichiesta).toLocaleDateString("it-IT") : "" },
              { header: "Origine", accessor: (t) => t.magazzinoOrigineNome },
              { header: "Destinazione", accessor: (t) => t.magazzinoDestinoNome },
              { header: "Articoli", accessor: (t) => t.righe?.length ?? 0 },
              { header: "Stato", accessor: (t) => t.stato?.replace('_', ' ') },
            ]}
            filename="trasferimenti"
            title="Trasferimenti"
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Nuovo</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codice</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Percorso</TableHead>
                <TableHead>Dettaglio</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="text-right w-[150px]">Azione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : trasferimenti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Nessun trasferimento registrato.</TableCell>
                </TableRow>
              ) : trasferimenti?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-sm font-medium">{t.codice}</TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(t.dataRichiesta), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{t.magazzinoOrigineNome}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{t.magazzinoDestinoNome}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.righe?.length || 0} articoli
                  </TableCell>
                  <TableCell className="text-center">
                    {getStatusBadge(t.stato)}
                  </TableCell>
                  <TableCell className="text-right">
                    {(t.stato === 'richiesto' || t.stato === 'preparato') && (
                      <Button size="sm" variant="outline" className="gap-1 border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => handleAction(t)} disabled={avviaTrasferimento.isPending}>
                        <Play className="h-3.5 w-3.5" /> Avvia
                      </Button>
                    )}
                    {t.stato === 'in_transito' && (
                      <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700" onClick={() => handleAction(t)} disabled={confermaTrasferimento.isPending}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Conferma Ric.
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Nuovo Trasferimento</SheetTitle>
          </SheetHeader>
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
             <ArrowRightLeft className="h-12 w-12 text-muted-foreground/30" />
             <p className="text-sm text-muted-foreground max-w-[250px]">Il form di creazione richiede la gestione delle righe multiple. (Stub per prototipo veloce)</p>
             <Button variant="outline" onClick={() => setIsFormOpen(false)}>Chiudi</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
