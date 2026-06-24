import { useState } from "react";
import { useListGiacenze, useListMagazzini, useListProdotti } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Filter, AlertTriangle, Star } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { ExportButtons } from "@/components/export-buttons";
import { useTranslation } from "react-i18next";

export default function Giacenze() {
  const { t } = useTranslation();
  const [magazzinoId, setMagazzinoId] = useState<string>("all");
  const [sottoscortaOnly, setSottoscortaOnly] = useState(false);
  const [fsePlusOnly, setFsePlusOnly] = useState(false);
  
  const { data: magazzini } = useListMagazzini();
  
  const { data: giacenze, isLoading } = useListGiacenze({
    magazzinoId: magazzinoId !== "all" ? Number(magazzinoId) : undefined,
    sottoscortaOnly: sottoscortaOnly || undefined,
    fsePlusOnly: fsePlusOnly || undefined
  });

  const magazzinoNome = magazzinoId !== "all"
    ? magazzini?.find(m => m.id.toString() === magazzinoId)?.nome ?? t("giacenze.warehouseFallback")
    : null;
  const inventarioTitolo = magazzinoNome
    ? t("giacenze.inventoryFor", { name: magazzinoNome })
    : t("giacenze.inventoryAll");
  const inventarioFile = magazzinoNome
    ? `inventario_${magazzinoNome.replace(/\s+/g, "_").toLowerCase()}`
    : "inventario_tutti_magazzini";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("giacenze.title")}</h1>
          <p className="text-muted-foreground">{t("giacenze.subtitle")}</p>
        </div>
        <ExportButtons
          rows={giacenze ?? []}
          filename={inventarioFile}
          title={inventarioTitolo}
          subtitle={[sottoscortaOnly ? t("giacenze.exportSubtitleSottoscorta") : null, fsePlusOnly ? t("giacenze.exportSubtitleFsePlus") : null].filter(Boolean).join(" · ") || undefined}
          sheetName={t("giacenze.sheetName")}
          orientation="landscape"
          columns={[
            { header: t("giacenze.colCodice"), accessor: (g) => g.prodottoCodice },
            { header: t("giacenze.colProdotto"), accessor: (g) => g.prodottoNome },
            { header: t("giacenze.colTipo"), accessor: (g) => g.tipoProdotto?.replace("_", " ") },
            { header: t("giacenze.colMagazzino"), accessor: (g) => g.magazzinoNome },
            { header: t("giacenze.colQtaTotale"), accessor: (g) => g.quantitaTotale },
            { header: t("giacenze.colUM"), accessor: (g) => g.unitaMisura },
            { header: t("giacenze.colScortaMinima"), accessor: (g) => g.scortaMinima },
            { header: t("giacenze.colProssimaScadenza"), accessor: (g) => g.prossimaScadenza ? new Date(g.prossimaScadenza).toLocaleDateString("it-IT") : "" },
            { header: t("giacenze.colStato"), accessor: (g) => g.sottoscorta ? t("giacenze.statusSottoscorta") : t("giacenze.statusRegolare") },
          ]}
        />
      </div>

      <Card>
        <CardHeader className="py-4 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("giacenze.allWarehouses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("giacenze.allWarehouses")}</SelectItem>
                  {magazzini?.map(m => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2 bg-blue-500/10 px-3 py-1.5 rounded-md border border-blue-500/20">
              <Switch id="fseplus" checked={fsePlusOnly} onCheckedChange={setFsePlusOnly} />
              <Label htmlFor="fseplus" className="text-blue-700 font-medium cursor-pointer flex items-center gap-1">
                <Star className="h-3 w-3" /> {t("giacenze.fsePlusOnly")}
              </Label>
            </div>

            <div className="flex items-center space-x-2 ml-auto bg-amber-500/10 px-3 py-1.5 rounded-md border border-amber-500/20">
              <Switch id="sottoscorta" checked={sottoscortaOnly} onCheckedChange={setSottoscortaOnly} />
              <Label htmlFor="sottoscorta" className="text-amber-700 font-medium cursor-pointer flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {t("giacenze.sottoscortaOnly")}
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">{t("giacenze.colCodice")}</TableHead>
                <TableHead>{t("giacenze.colProdotto")}</TableHead>
                <TableHead>{t("giacenze.colMagazzino")}</TableHead>
                <TableHead className="text-right">{t("giacenze.colQtaTotale")}</TableHead>
                <TableHead className="text-right">{t("giacenze.colScortaMinima")}</TableHead>
                <TableHead className="text-center">{t("giacenze.colProssimaScad")}</TableHead>
                <TableHead className="w-[120px] text-center">{t("giacenze.colStato")}</TableHead>
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
                    {t("giacenze.noResults")}
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
                      <Badge variant="outline" className="bg-amber-500 text-white border-amber-600">{t("giacenze.statusSottoscorta")}</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-500/10 text-green-700 border-none">{t("giacenze.statusRegolare")}</Badge>
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
