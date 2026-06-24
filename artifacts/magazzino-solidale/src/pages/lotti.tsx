import { useState } from "react";
import { useListLotti, useListMagazzini, useListProdotti } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calendar, Filter } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { it } from "date-fns/locale";

export default function Lotti() {
  const [magazzinoId, setMagazzinoId] = useState<string>("all");
  const [prodottoId, setProdottoId] = useState<string>("all");
  const [inScadenza, setInScadenza] = useState(false);
  
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  
  const { data: lotti, isLoading } = useListLotti({
    magazzinoId: magazzinoId !== "all" ? Number(magazzinoId) : undefined,
    prodottoId: prodottoId !== "all" ? Number(prodottoId) : undefined,
    inScadenza: inScadenza || undefined
  });

  const getExpiryStatus = (dateStr: string | null | undefined) => {
    if (!dateStr) return { label: "No Scadenza", color: "text-muted-foreground", badge: "bg-gray-100 text-gray-800" };
    
    const expiryDate = new Date(dateStr);
    const daysLeft = differenceInDays(expiryDate, new Date());
    
    if (daysLeft < 0) return { label: "Scaduto", color: "text-destructive font-bold", badge: "bg-destructive text-destructive-foreground" };
    if (daysLeft <= 7) return { label: "Critico", color: "text-destructive font-semibold", badge: "bg-destructive/90 text-destructive-foreground" };
    if (daysLeft <= 30) return { label: "Attenzione", color: "text-amber-600 font-medium", badge: "bg-amber-500 text-white" };
    return { label: "Regolare", color: "text-green-600", badge: "bg-green-500/20 text-green-700" };
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tracciamento Lotti e Scadenze</h1>
          <p className="text-muted-foreground">Monitora le date di scadenza per prevenire gli sprechi alimentari.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger className="w-[180px]">
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
            
            <div className="flex items-center gap-2">
              <Select value={prodottoId} onValueChange={setProdottoId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Tutti i prodotti" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i prodotti</SelectItem>
                  {prodotti?.filter(p => p.gestioneScadenza || p.gestioneLotto).map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2 ml-auto bg-amber-500/10 px-3 py-1.5 rounded-md border border-amber-500/20">
              <Switch id="scadenza" checked={inScadenza} onCheckedChange={setInScadenza} />
              <Label htmlFor="scadenza" className="text-amber-700 font-medium cursor-pointer">
                Solo in scadenza (≤ 30gg)
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cod. Lotto</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Magazzino</TableHead>
                <TableHead>Data Scadenza</TableHead>
                <TableHead className="text-right">Q.tà Iniziale</TableHead>
                <TableHead className="text-right">Q.tà Residua</TableHead>
                <TableHead className="w-[100px] text-center">Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : lotti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nessun lotto trovato con questi filtri.
                  </TableCell>
                </TableRow>
              ) : lotti?.map((lotto) => {
                const status = getExpiryStatus(lotto.dataScadenza);
                // Highlight row if critical
                const isCritical = status.label === "Critico" || status.label === "Scaduto";
                const isWarning = status.label === "Attenzione";
                
                return (
                  <TableRow key={lotto.id} className={isCritical ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20" : isWarning ? "bg-amber-50/30 hover:bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell className="font-mono text-xs font-medium">
                      {lotto.codiceLotto || <span className="text-muted-foreground italic">N/D</span>}
                    </TableCell>
                    <TableCell className="font-medium">{lotto.prodottoNome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lotto.magazzinoNome}</TableCell>
                    <TableCell>
                      {lotto.dataScadenza ? (
                        <div className={`flex items-center gap-2 text-sm ${status.color}`}>
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(lotto.dataScadenza), "dd MMM yyyy", { locale: it })}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm italic">Non prevista</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{lotto.quantitaCaricata}</TableCell>
                    <TableCell className="text-right font-bold">{lotto.quantitaResidua}</TableCell>
                    <TableCell className="text-center">
                      {lotto.dataScadenza && (
                        <Badge variant="outline" className={`border-none ${status.badge}`}>
                          {status.label}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
