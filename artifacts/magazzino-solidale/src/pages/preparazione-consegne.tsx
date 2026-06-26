import { useState, useMemo } from "react";
import {
  useGetPreparazioneConsegne,
  useListMagazzini,
  useListCitta,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Filter,
  PackageCheck,
  Truck,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { ExportButtons } from "@/components/export-buttons";
import { useTranslation } from "react-i18next";

export default function PreparazioneConsegne() {
  const { t } = useTranslation();
  const [cittaId, setCittaId] = useState<string>("all");
  const [magazzinoId, setMagazzinoId] = useState<string>("all");

  const { data: citta } = useListCitta();
  const { data: magazzini } = useListMagazzini();

  const magazziniFiltrati = useMemo(() => {
    if (!magazzini) return [];
    if (cittaId === "all") return magazzini;
    return magazzini.filter((m) => m.cittaId?.toString() === cittaId);
  }, [magazzini, cittaId]);

  const hasMagazzino = magazzinoId !== "all";

  const queryParams = {
    cittaId: cittaId !== "all" ? Number(cittaId) : undefined,
    magazzinoId: hasMagazzino ? Number(magazzinoId) : undefined,
  };

  const { data, isLoading } = useGetPreparazioneConsegne(queryParams, {
    query: {
      enabled: hasMagazzino,
      queryKey: ["preparazione-consegne", cittaId, magazzinoId],
    },
  });

  const righe = data?.righe ?? [];
  const consegne = data?.consegne ?? [];

  const magazzinoNome =
    magazzini?.find((m) => m.id.toString() === magazzinoId)?.nome ?? "";
  const exportFile = magazzinoNome
    ? `${t("preparazioneConsegne.exportFile")}_${magazzinoNome
        .replace(/\s+/g, "_")
        .toLowerCase()}`
    : t("preparazioneConsegne.exportFile");

  const handleCittaChange = (v: string) => {
    setCittaId(v);
    setMagazzinoId("all");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("preparazioneConsegne.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("preparazioneConsegne.subtitle")}
          </p>
        </div>
        <ExportButtons
          rows={righe}
          filename={exportFile}
          title={t("preparazioneConsegne.exportTitle")}
          subtitle={magazzinoNome || undefined}
          sheetName={t("preparazioneConsegne.sheetName")}
          orientation="landscape"
          disabled={!hasMagazzino || righe.length === 0}
          columns={[
            {
              header: t("preparazioneConsegne.colCodice"),
              accessor: (r) => r.prodottoCodice ?? "",
            },
            {
              header: t("preparazioneConsegne.colProdotto"),
              accessor: (r) => r.prodottoNome,
            },
            {
              header: t("preparazioneConsegne.colRichiesta"),
              accessor: (r) => r.quantitaRichiesta,
            },
            {
              header: t("preparazioneConsegne.colUM"),
              accessor: (r) => r.unitaMisura,
            },
            {
              header: t("preparazioneConsegne.colConsegne"),
              accessor: (r) => r.numConsegne,
            },
            {
              header: t("preparazioneConsegne.colDisponibile"),
              accessor: (r) => r.quantitaDisponibile,
            },
            {
              header: t("preparazioneConsegne.colStato"),
              accessor: (r) =>
                r.sufficiente
                  ? t("preparazioneConsegne.sufficiente")
                  : t("preparazioneConsegne.insufficiente"),
            },
          ]}
        />
      </div>

      <Card>
        <CardHeader className="py-4 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={cittaId} onValueChange={handleCittaChange}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue
                    placeholder={t("preparazioneConsegne.selectCitta")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("preparazioneConsegne.allCitta")}
                  </SelectItem>
                  {citta?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue
                    placeholder={t("preparazioneConsegne.selectMagazzino")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("preparazioneConsegne.allMagazzini")}
                  </SelectItem>
                  {magazziniFiltrati.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
      </Card>

      {!hasMagazzino ? (
        <Card>
          <CardContent className="h-40 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <PackageCheck className="h-8 w-8 opacity-40" />
            <p>{t("preparazioneConsegne.selectPrompt")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <PackageCheck className="h-5 w-5 text-primary" />
                    {t("preparazioneConsegne.goodsTitle")}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("preparazioneConsegne.goodsSubtitle")}
                  </p>
                </div>
                {!isLoading && righe.length > 0 && (
                  <Badge variant="secondary">
                    {t("preparazioneConsegne.summaryProdotti", {
                      count: righe.length,
                    })}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">
                      {t("preparazioneConsegne.colCodice")}
                    </TableHead>
                    <TableHead>
                      {t("preparazioneConsegne.colProdotto")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("preparazioneConsegne.colRichiesta")}
                    </TableHead>
                    <TableHead className="text-center">
                      {t("preparazioneConsegne.colConsegne")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("preparazioneConsegne.colDisponibile")}
                    </TableHead>
                    <TableHead className="w-[130px] text-center">
                      {t("preparazioneConsegne.colStato")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array(5)
                      .fill(0)
                      .map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-5 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-40" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-16 ml-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-10 mx-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-16 ml-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-6 w-20 mx-auto rounded-full" />
                          </TableCell>
                        </TableRow>
                      ))
                  ) : righe.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-32 text-center text-muted-foreground"
                      >
                        {t("preparazioneConsegne.noGoods")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    righe.map((r) => (
                      <TableRow
                        key={r.prodottoId}
                        className={
                          !r.sufficiente
                            ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20"
                            : ""
                        }
                      >
                        <TableCell className="font-mono text-xs">
                          {r.prodottoCodice}
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.prodottoNome}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold">
                            {r.quantitaRichiesta}
                          </span>{" "}
                          <span className="text-xs text-muted-foreground">
                            {r.unitaMisura}
                          </span>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {r.numConsegne}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {r.quantitaDisponibile} {r.unitaMisura}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.sufficiente ? (
                            <Badge
                              variant="outline"
                              className="bg-green-500/10 text-green-700 border-none gap-1"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {t("preparazioneConsegne.sufficiente")}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-red-500 text-white border-red-600 gap-1"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {t("preparazioneConsegne.insufficiente")}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Truck className="h-5 w-5 text-primary" />
                    {t("preparazioneConsegne.consegneTitle")}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("preparazioneConsegne.consegneSubtitle")}
                  </p>
                </div>
                {!isLoading && consegne.length > 0 && (
                  <Badge variant="secondary">
                    {t("preparazioneConsegne.summaryConsegne", {
                      count: consegne.length,
                    })}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("preparazioneConsegne.colDataPrevista")}
                    </TableHead>
                    <TableHead>
                      {t("preparazioneConsegne.colCodice")}
                    </TableHead>
                    <TableHead>
                      {t("preparazioneConsegne.colBeneficiario")}
                    </TableHead>
                    <TableHead>{t("preparazioneConsegne.colTipo")}</TableHead>
                    <TableHead>{t("preparazioneConsegne.colBolla")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array(3)
                      .fill(0)
                      .map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-5 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-20" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-40" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-5 w-24" />
                          </TableCell>
                        </TableRow>
                      ))
                  ) : consegne.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {t("preparazioneConsegne.noConsegne")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    consegne.map((c) => (
                      <TableRow key={`${c.consegnaId}-${c.bollaId}`}>
                        <TableCell className="text-sm">
                          {c.dataPrevista
                            ? format(new Date(c.dataPrevista), "dd MMM yyyy", {
                                locale: it,
                              })
                            : "-"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.codice}
                        </TableCell>
                        <TableCell className="font-medium">
                          {c.beneficiarioNome}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground capitalize">
                          {c.tipoConsegna?.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.bollaNumero}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
