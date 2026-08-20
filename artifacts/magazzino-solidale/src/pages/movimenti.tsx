import { useState, useEffect } from "react";
import { listMovimenti, useListMovimenti, useListCentriAscolto } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { ArrowDownRight, ArrowUpRight, Filter } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { loadAllPages } from "@/lib/paged-export";

export default function Movimenti() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;

  const [tipoFilter, setTipoFilter] = useState("all");
  const [centroFilter, setCentroFilter] = useState(isCentroLocked ? String(lockedCentroId) : "all");
  const [da, setDa] = useState("");
  const [a, setA] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  useEffect(() => setPage(1), [tipoFilter, centroFilter, da, a]);
  const filterParams = {
    tipo: tipoFilter !== "all" ? tipoFilter : undefined,
    centroAscoltoId: centroFilter !== "all" ? parseInt(centroFilter) : undefined,
    da: da || undefined,
    a: a || undefined,
  };
  const { data: movimenti, isLoading } = useListMovimenti({
    ...filterParams,
    page,
    limit: pageSize,
  });
  const { data: centri } = useListCentriAscolto();

  const causaleLabel = (val: string) => {
    const map: Record<string, string> = {
      acquisto: t("movimenti.causaleAcquisto"),
      donazione: t("movimenti.causaleDonazione"),
      rettifica_inventario: t("movimenti.causaleRettifica"),
      scadenza: t("movimenti.causaleScadenza"),
      smaltimento: t("movimenti.causaleSmaltimento"),
    };
    return map[val] ?? val.replace("_", " ");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("movimenti.title")}</h1>
          <p className="text-muted-foreground">{t("movimenti.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={movimenti ?? []}
            loadRows={() => loadAllPages((exportPage, limit) => listMovimenti({ ...filterParams, page: exportPage, limit }))}
            columns={[
              { header: t("movimenti.colData"), accessor: (m) => m.dataMovimento ? new Date(m.dataMovimento).toLocaleDateString("it-IT") : "" },
              { header: t("movimenti.colTipo"), accessor: (m) => m.tipoMovimento },
              { header: t("movimenti.colCausale"), accessor: (m) => m.tipoDettaglio },
              { header: t("movimenti.colProdotto"), accessor: (m) => m.prodottoNome },
              { header: t("movimenti.colMagazzino"), accessor: (m) => m.magazzinoNome },
              { header: t("movimenti.colQuantita"), accessor: (m) => m.quantita != null ? parseFloat(String(m.quantita)) : "" },
              { header: t("movimenti.colUM"), accessor: (m) => m.unitaMisura },
              { header: t("movimenti.colNote"), accessor: (m) => m.note },
            ]}
            filename="movimenti"
            title={t("movimenti.exportTitle")}
            orientation="landscape"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 self-center">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("movimenti.allMovements")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("movimenti.allMovements")}</SelectItem>
                  <SelectItem value="carico">{t("movimenti.onlyLoads")}</SelectItem>
                  <SelectItem value="scarico">{t("movimenti.onlyUnloads")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("movimenti.filterCentro")}</Label>
              <Select value={centroFilter} onValueChange={setCentroFilter} disabled={isCentroLocked}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("movimenti.allCentri")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("movimenti.filterDa")}</Label>
              <Input type="date" value={da} onChange={(e) => setDa(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("movimenti.filterA")}</Label>
              <Input type="date" value={a} onChange={(e) => setA(e.target.value)} className="w-[160px]" />
            </div>
            {(da || a || centroFilter !== "all") && !isCentroLocked && (
              <Button variant="ghost" size="sm" onClick={() => { setDa(""); setA(""); setCentroFilter("all"); }}>
                {t("movimenti.filterReset")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("movimenti.colData")}</TableHead>
                <TableHead>{t("movimenti.colTipo")}</TableHead>
                <TableHead>{t("movimenti.colProdotto")}</TableHead>
                <TableHead>{t("movimenti.colMagazzino")}</TableHead>
                <TableHead className="text-right">{t("movimenti.colQuantita")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : movimenti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">{t("movimenti.noResults")}</TableCell>
                </TableRow>
              ) : movimenti?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm">
                    {format(new Date(m.dataMovimento), "dd MMM yyyy, HH:mm", { locale: it })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {m.tipoMovimento === 'carico' ? (
                        <ArrowDownRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-amber-500" />
                      )}
                      <Badge variant="outline" className="capitalize">
                        {causaleLabel(m.tipoDettaglio)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{m.prodottoNome}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.magazzinoNome}</TableCell>
                  <TableCell className={`text-right font-bold ${m.tipoMovimento === 'carico' ? 'text-green-600' : 'text-amber-600'}`}>
                    {m.tipoMovimento === 'carico' ? '+' : '-'}{m.quantita} <span className="text-xs font-normal text-muted-foreground">{m.unitaMisura}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page === 1 || isLoading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Precedente</Button>
        <span className="text-sm text-muted-foreground">Pagina {page}</span>
        <Button variant="outline" size="sm" disabled={isLoading || (movimenti?.length ?? 0) < pageSize} onClick={() => setPage((value) => value + 1)}>Successiva</Button>
      </div>

    </div>
  );
}
