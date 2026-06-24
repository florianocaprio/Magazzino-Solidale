import { useState } from "react";
import { useListGiacenze, useListMagazzini, useListProdotti } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Filter, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";

export default function Giacenze() {
  const [magazzinoId, setMagazzinoId] = useState<string>("all");
  const [sottoscortaOnly, setSottoscortaOnly] = useState(false);
  
  const { data: magazzini } = useListMagazzini();
  
  const { data: giacenze, isLoading } = useListGiacenze({
    magazzinoId: magazzinoId !== "all" ? Number(magazzinoId) : undefined,
    sottoscortaOnly: sottoscortaOnly || undefined
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Giacenze</h1>
          <p className="text-muted-foreground">Monitora le quantità disponibili nei magazzini.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Tutti i magazzini" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i magazzini</SelectItem>
                  {magazzini?.map(m => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2 ml-auto bg-amber-500/10 px-3 py-1.5 rounded-md border border-amber-500/20">
              <Switch id="sottoscorta" checked={sottoscortaOnly} onCheckedChange={setSottoscortaOnly} />
              <Label htmlFor="sottoscorta" className="text-amber-700 font-medium cursor-pointer flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Solo Sottoscorta
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Codice</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Magazzino</TableHead>
                <TableHead className="text-right">Q.tà Totale</TableHead>
                <TableHead className="text-right">Scorta Minima</TableHead>
                <TableHead className="text-center">Prossima Scad.</TableHead>
                <TableHead className="w-[120px] text-center">Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : giacenze?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nessuna giacenza trovata.
                  </TableCell>
                </TableRow>
              ) : giacenze?.map((g, idx) => (
                <TableRow key={`${g.prodottoId}-${g.magazzinoId}-${idx}`} className={g.sottoscorta ? "bg-amber-50/50 hover:bg-amber-50 dark:bg-amber-950/20" : ""}>
                  <TableCell className="font-mono text-xs">{g.prodottoCodice}</TableCell>
                  <TableCell>
                    <div className="font-medium">{g.prodottoNome}</div>
                    <div className="text-xs text-muted-foreground capitalize">{g.tipoProdotto.replace('_', ' ')}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{g.magazzinoNome}</TableCell>
                  <TableCell className="text-right">
                    <span className="font-bold">{g.quantitaTotale}</span> <span className="text-xs text-muted-foreground">{g.unitaMisura}</span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {g.scortaMinima}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {g.prossimaScadenza ? (
                      format(new Date(g.prossimaScadenza), "dd MMM yyyy", { locale: it })
                    ) : (
                      <span className="text-muted-foreground italic">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {g.sottoscorta ? (
                      <Badge variant="outline" className="bg-amber-500 text-white border-amber-600">Sottoscorta</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-500/10 text-green-700 border-none">Regolare</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
