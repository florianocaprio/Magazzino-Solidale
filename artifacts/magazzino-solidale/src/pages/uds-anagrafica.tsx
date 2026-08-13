import { useMemo, useState } from "react";
import {
  getGetBeneficiarioQueryKey,
  getListBeneficiariQueryKey,
  getListCittaQueryKey,
  type Beneficiario,
  useListBeneficiari,
  useListCitta,
  useListZoneUds,
  useUpdateBeneficiario,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Footprints, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ExportButtons } from "@/components/export-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UdsPersonaSheet } from "@/components/uds-persona-sheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const ALL_ZONE = "__all__";

export default function UdsAnagrafica() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isGlobal = user?.cittaId == null;
  const [filterCitta, setFilterCitta] = useState("");
  const [filterZona, setFilterZona] = useState(
    user?.zonaUdsId != null ? String(user.zonaUdsId) : ALL_ZONE,
  );
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);

  const { data: cittaList } = useListCitta({
    query: { queryKey: getListCittaQueryKey(), enabled: isGlobal },
  });
  const effectiveCitta = isGlobal
    ? filterCitta
      ? parseInt(filterCitta)
      : undefined
    : (user?.cittaId ?? undefined);
  const { data: zoneList } = useListZoneUds(
    effectiveCitta ? { cittaId: effectiveCitta } : undefined,
    { query: { queryKey: ["zoneUds", effectiveCitta], enabled: effectiveCitta != null } },
  );

  const listParams = {
    uds: true,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(isGlobal && effectiveCitta ? { cittaId: effectiveCitta } : {}),
    ...(filterZona !== ALL_ZONE ? { zonaUdsId: parseInt(filterZona) } : {}),
  };
  const { data: beneficiari, isLoading } = useListBeneficiari(listParams);
  const updateBenef = useUpdateBeneficiario();

  const toggleStatus = (beneficiario: { id: number; attivo: boolean }) => {
    updateBenef.mutate(
      { id: beneficiario.id, data: { attivo: !beneficiario.attivo } as never },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(beneficiario.id) });
          toast({
            title: beneficiario.attivo
              ? t("beneficiari.toastDisattivato")
              : t("beneficiari.toastAttivato"),
          });
        },
      },
    );
  };

  const canale = (beneficiario: Beneficiario) => {
    const uds = beneficiario.uds;
    const centro = beneficiario.centroAscoltoId != null;
    if (uds && centro) {
      return {
        label: t("udsAnagrafica.canaleEntrambi"),
        cls: "bg-purple-500/10 text-purple-700",
      };
    }
    if (centro) {
      return { label: t("udsAnagrafica.canaleCentro"), cls: "bg-blue-500/10 text-blue-700" };
    }
    if (uds) {
      return { label: t("udsAnagrafica.canaleUds"), cls: "bg-amber-500/10 text-amber-700" };
    }
    return { label: t("udsAnagrafica.canaleNd"), cls: "bg-muted text-muted-foreground" };
  };

  const rows = beneficiari ?? [];
  const exportColumns = useMemo(
    () => [
      { header: t("common.surname"), accessor: (b: Beneficiario) => b.cognome },
      { header: t("common.name"), accessor: (b: Beneficiario) => b.nome },
      {
        header: t("udsAnagrafica.colSoprannome"),
        accessor: (b: Beneficiario) => b.soprannome ?? "",
      },
      { header: t("udsAnagrafica.colTelefono"), accessor: (b: Beneficiario) => b.telefono ?? "" },
      { header: t("udsAnagrafica.colZona"), accessor: (b: Beneficiario) => b.zonaUdsNome ?? "" },
      { header: t("udsAnagrafica.colCanale"), accessor: (b: Beneficiario) => canale(b).label },
    ],
    [t],
  );

  const initialZona =
    filterZona !== ALL_ZONE
      ? parseInt(filterZona)
      : user?.zonaUdsId != null
        ? user.zonaUdsId
        : null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("udsAnagrafica.title")}</h1>
          <p className="text-muted-foreground">{t("udsAnagrafica.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={rows}
            columns={exportColumns}
            filename="uds-anagrafica"
            title={t("udsAnagrafica.exportTitle")}
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> {t("udsAnagrafica.newPerson")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1 min-w-[240px] flex-1">
            <span className="text-sm font-medium">{t("udsAnagrafica.searchLabel")}</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("udsAnagrafica.searchPlaceholder")}
                className="pl-9"
              />
            </div>
          </div>
          {isGlobal && (
            <div className="space-y-1">
              <span className="text-sm font-medium">{t("udsAnagrafica.filterCitta")}</span>
              <Select
                value={filterCitta || ALL_ZONE}
                onValueChange={(value) => {
                  setFilterCitta(value === ALL_ZONE ? "" : value);
                  setFilterZona(ALL_ZONE);
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder={t("udsAnagrafica.allCitta")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allCitta")}</SelectItem>
                  {cittaList?.map((citta) => (
                    <SelectItem key={citta.id} value={String(citta.id)}>
                      {citta.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-sm font-medium">{t("udsAnagrafica.filterZona")}</span>
            <Select value={filterZona} onValueChange={setFilterZona}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t("udsAnagrafica.allZone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allZone")}</SelectItem>
                {zoneList?.map((zona) => (
                  <SelectItem key={zona.id} value={String(zona.id)}>
                    {zona.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.surname")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("udsAnagrafica.colSoprannome")}</TableHead>
                <TableHead>{t("udsAnagrafica.colTelefono")}</TableHead>
                <TableHead>{t("udsAnagrafica.colZona")}</TableHead>
                <TableHead className="text-center">{t("udsAnagrafica.colCanale")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colStato")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(4)
                  .fill(0)
                  .map((_, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {Array(7)
                        .fill(0)
                        .map((_, cellIndex) => (
                          <TableCell key={cellIndex}><Skeleton className="h-5 w-24" /></TableCell>
                        ))}
                    </TableRow>
                  ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    {t("udsAnagrafica.noPersone")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((beneficiario) => {
                  const channel = canale(beneficiario);
                  return (
                    <TableRow key={beneficiario.id} className={!beneficiario.attivo ? "opacity-60" : ""}>
                      <TableCell>
                        <Link
                          href={`/beneficiari/${beneficiario.id}`}
                          className="flex items-center gap-2 font-medium text-primary hover:underline"
                        >
                          <Footprints className="h-4 w-4 text-muted-foreground" /> {beneficiario.cognome}
                        </Link>
                      </TableCell>
                      <TableCell>{beneficiario.nome}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {beneficiario.soprannome || "-"}
                      </TableCell>
                      <TableCell className="text-sm">{beneficiario.telefono || "-"}</TableCell>
                      <TableCell className="text-sm">{beneficiario.zonaUdsNome || "-"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`border-none ${channel.cls}`}>
                          {channel.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center">
                          <Switch
                            checked={beneficiario.attivo}
                            onCheckedChange={() => toggleStatus(beneficiario)}
                            aria-label={
                              beneficiario.attivo
                                ? t("beneficiari.disattiva")
                                : t("beneficiari.attiva")
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <UdsPersonaSheet
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        initialCittaId={effectiveCitta}
        initialZonaUdsId={initialZona}
      />
    </div>
  );
}
