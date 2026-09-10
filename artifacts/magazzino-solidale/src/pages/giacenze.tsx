import { useEffect, useState } from "react";
import {
  useListAreeOperative,
  useListGiacenze,
  useListMagazzini,
  getListGiacenzeQueryKey,
  type Giacenza,
} from "@workspace/api-client-react";
import {
  activeOperationalAreas,
  AreaMagazzinoSelector,
  operationalWarehousesForArea,
} from "@/components/area-magazzino-selector";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Filter, Star } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { ExportButtons } from "@/components/export-buttons";
import type { ExportColumn } from "@/lib/export";
import { useTranslation } from "react-i18next";

function filenamePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export default function Giacenze() {
  const { t } = useTranslation();
  const [areaId, setAreaId] = useState("");
  const [magazzinoId, setMagazzinoId] = useState("all");
  const [sottoscortaOnly, setSottoscortaOnly] = useState(false);
  const [fsePlusOnly, setFsePlusOnly] = useState(false);

  const { data: aree, isLoading: areeLoading } = useListAreeOperative();
  const { data: magazzini } = useListMagazzini();
  const areeAttive = activeOperationalAreas(aree);
  const selectedAreaId = areaId ? Number(areaId) : null;
  const magazziniArea = operationalWarehousesForArea(magazzini, selectedAreaId);

  useEffect(() => {
    if (areeAttive.length === 1 && !areaId) {
      setAreaId(String(areeAttive[0].id));
      return;
    }
    if (areaId && !areeAttive.some((area) => String(area.id) === areaId)) {
      setAreaId("");
      setMagazzinoId("all");
      setSottoscortaOnly(false);
    }
  }, [areaId, areeAttive]);

  const selectedWarehouseId =
    magazzinoId === "all" ? null : Number(magazzinoId);
  const selectedArea = areeAttive.find((area) => area.id === selectedAreaId);
  const selectedWarehouse = magazziniArea.find(
    (warehouse) => warehouse.id === selectedWarehouseId,
  );
  const isAreaMode = selectedWarehouseId == null;

  const queryParams = {
    areaOperativaId: selectedAreaId ?? 0,
    magazzinoId: selectedWarehouseId ?? undefined,
    sottoscortaOnly:
      selectedWarehouseId != null && sottoscortaOnly ? true : undefined,
    fsePlusOnly: fsePlusOnly || undefined,
  };
  const { data: responseGiacenze, isLoading: giacenzeLoading } =
    useListGiacenze(queryParams, {
      query: {
        enabled: selectedAreaId != null,
        queryKey: getListGiacenzeQueryKey(queryParams),
      },
    });

  const responseMatchesCurrentScope = responseGiacenze?.every(
    (row) =>
      row.areaOperativaId === selectedAreaId &&
      (selectedWarehouseId == null
        ? row.ambito === "area" && row.magazzinoId == null
        : row.ambito === "magazzino" &&
          row.magazzinoId === selectedWarehouseId),
  );
  const giacenze = responseMatchesCurrentScope ? responseGiacenze : undefined;
  const isLoading = selectedAreaId != null && giacenzeLoading;

  const onAreaChange = (value: string) => {
    setAreaId(value);
    setMagazzinoId("all");
    setSottoscortaOnly(false);
  };
  const onWarehouseChange = (value: string) => {
    setMagazzinoId(value);
    if (value === "all") setSottoscortaOnly(false);
  };

  const inventoryTitle = selectedWarehouse
    ? t("giacenze.inventoryFor", { name: selectedWarehouse.nome })
    : selectedArea
      ? t("giacenze.inventoryArea", { name: selectedArea.nome })
      : t("giacenze.title");
  const inventoryFilename = selectedWarehouse
    ? `inventario_magazzino_${filenamePart(selectedWarehouse.nome)}`
    : selectedArea
      ? `inventario_area_${filenamePart(selectedArea.nome)}`
      : "inventario_area";

  const commonExportColumns: ExportColumn<Giacenza>[] = [
    { header: t("giacenze.colCodice"), accessor: (row) => row.prodottoCodice },
    { header: t("giacenze.colProdotto"), accessor: (row) => row.prodottoNome },
    {
      header: t("giacenze.colGiacenzaFisica"),
      accessor: (row) => row.giacenzaFisica,
    },
    { header: t("giacenze.colImpegnato"), accessor: (row) => row.impegnato },
    {
      header: t("giacenze.colDisponibileReale"),
      accessor: (row) => Math.max(0, row.disponibileReale),
    },
    { header: t("giacenze.colUM"), accessor: (row) => row.unitaMisura },
    {
      header: t("giacenze.colProssimaScadenza"),
      accessor: (row) =>
        row.prossimaScadenza
          ? new Date(row.prossimaScadenza).toLocaleDateString("it-IT")
          : "",
    },
  ];
  const exportColumns: ExportColumn<Giacenza>[] = isAreaMode
    ? commonExportColumns
    : [
        ...commonExportColumns.slice(0, 2),
        {
          header: t("giacenze.colMagazzino"),
          accessor: (row) => row.magazzinoNome ?? "",
        },
        ...commonExportColumns.slice(2),
        {
          header: t("giacenze.colScortaMinima"),
          accessor: (row) => row.scortaMinima ?? "",
        },
        {
          header: t("giacenze.colStato"),
          accessor: (row) =>
            row.sottoscorta
              ? t("giacenze.statusSottoscorta")
              : t("giacenze.statusRegolare"),
        },
      ];

  const emptyMessage =
    areeAttive.length === 0 && !areeLoading
      ? t("giacenze.noActiveAreas")
      : !selectedArea
        ? t("giacenze.selectAreaHelp")
        : magazziniArea.length === 0
          ? t("giacenze.noAreaWarehouses")
          : t("giacenze.noResults");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {inventoryTitle}
          </h1>
          <p className="text-muted-foreground">
            {selectedArea
              ? isAreaMode
                ? t("giacenze.areaScopeSubtitle")
                : t("giacenze.warehouseScopeSubtitle", {
                    area: selectedArea.nome,
                  })
              : t("giacenze.subtitle")}
          </p>
        </div>
        {selectedArea && (
          <ExportButtons
            rows={giacenze ?? []}
            filename={inventoryFilename}
            title={inventoryTitle}
            subtitle={[
              isAreaMode ? t("giacenze.areaAggregate") : selectedArea.nome,
              sottoscortaOnly ? t("giacenze.exportSubtitleSottoscorta") : null,
              fsePlusOnly ? t("giacenze.exportSubtitleFsePlus") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            sheetName={t("giacenze.sheetName")}
            orientation="landscape"
            columns={exportColumns}
          />
        )}
      </div>

      <Card>
        <CardHeader className="py-4 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
            <Filter className="h-4 w-4 text-muted-foreground self-center" />
            <AreaMagazzinoSelector
              areas={areeAttive}
              warehouses={magazziniArea}
              areaId={areaId}
              warehouseId={magazzinoId}
              onAreaChange={onAreaChange}
              onWarehouseChange={onWarehouseChange}
            />

            {selectedArea && isAreaMode && (
              <Badge variant="outline">{t("giacenze.areaAggregate")}</Badge>
            )}

            <div className="flex items-center space-x-2 bg-blue-500/10 px-3 py-1.5 rounded-md border border-blue-500/20">
              <Switch
                id="fseplus"
                checked={fsePlusOnly}
                onCheckedChange={setFsePlusOnly}
                disabled={!selectedArea}
              />
              <Label
                htmlFor="fseplus"
                className="text-blue-700 font-medium cursor-pointer flex items-center gap-1"
              >
                <Star className="h-3 w-3" /> {t("giacenze.fsePlusOnly")}
              </Label>
            </div>

            <div className="flex items-center space-x-2 ml-auto bg-amber-500/10 px-3 py-1.5 rounded-md border border-amber-500/20">
              <Switch
                id="sottoscorta"
                checked={sottoscortaOnly}
                onCheckedChange={setSottoscortaOnly}
                disabled={selectedWarehouseId == null}
              />
              <Label
                htmlFor="sottoscorta"
                className="text-amber-700 font-medium cursor-pointer flex items-center gap-1"
              >
                <AlertTriangle className="h-3 w-3" />
                {t("giacenze.sottoscortaOnly")}
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">
                  {t("giacenze.colCodice")}
                </TableHead>
                <TableHead>{t("giacenze.colProdotto")}</TableHead>
                {!isAreaMode && (
                  <TableHead>{t("giacenze.colMagazzino")}</TableHead>
                )}
                <TableHead className="text-right">
                  {t("giacenze.colGiacenzaFisica")}
                </TableHead>
                <TableHead className="text-right">
                  {t("giacenze.colImpegnato")}
                </TableHead>
                <TableHead className="text-right">
                  {t("giacenze.colDisponibileReale")}
                </TableHead>
                {isAreaMode && (
                  <TableHead className="text-right">
                    {t("giacenze.colUM")}
                  </TableHead>
                )}
                {!isAreaMode && (
                  <TableHead className="text-right">
                    {t("giacenze.colScortaMinima")}
                  </TableHead>
                )}
                <TableHead className="text-center">
                  {t("giacenze.colProssimaScad")}
                </TableHead>
                {!isAreaMode && (
                  <TableHead className="w-[120px] text-center">
                    {t("giacenze.colStato")}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading || areeLoading ? (
                Array(5)
                  .fill(0)
                  .map((_, index) => (
                    <TableRow key={index}>
                      {Array(isAreaMode ? 7 : 9)
                        .fill(0)
                        .map((__, cellIndex) => (
                          <TableCell key={cellIndex}>
                            <Skeleton className="h-5 w-20" />
                          </TableCell>
                        ))}
                    </TableRow>
                  ))
              ) : !giacenze || giacenze.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isAreaMode ? 7 : 9}
                    className="h-32 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                giacenze.map((row) => (
                  <TableRow
                    key={`${row.prodottoId}-${row.unitaMisura}-${row.magazzinoId ?? "area"}`}
                    className={
                      row.sottoscorta
                        ? "bg-amber-50/50 hover:bg-amber-50 dark:bg-amber-950/20"
                        : ""
                    }
                  >
                    <TableCell className="font-mono text-xs">
                      {row.prodottoCodice}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.prodottoNome}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {row.tipoProdotto.replace("_", " ")}
                      </div>
                    </TableCell>
                    {!isAreaMode && (
                      <TableCell className="text-sm text-muted-foreground">
                        {row.magazzinoNome}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <span className="font-bold">{row.giacenzaFisica}</span>{" "}
                      {!isAreaMode && (
                        <span className="text-xs text-muted-foreground">
                          {row.unitaMisura}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium">{row.impegnato}</span>{" "}
                      {!isAreaMode && (
                        <span className="text-xs text-muted-foreground">
                          {row.unitaMisura}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-bold">
                        {Math.max(0, row.disponibileReale)}
                      </span>{" "}
                      {!isAreaMode && (
                        <span className="text-xs text-muted-foreground">
                          {row.unitaMisura}
                        </span>
                      )}
                    </TableCell>
                    {isAreaMode && (
                      <TableCell className="text-right text-muted-foreground">
                        {row.unitaMisura}
                      </TableCell>
                    )}
                    {!isAreaMode && (
                      <TableCell className="text-right text-muted-foreground">
                        {row.scortaMinima}
                      </TableCell>
                    )}
                    <TableCell className="text-center text-sm">
                      {row.prossimaScadenza ? (
                        format(new Date(row.prossimaScadenza), "dd MMM yyyy", {
                          locale: it,
                        })
                      ) : (
                        <span className="text-muted-foreground italic">-</span>
                      )}
                    </TableCell>
                    {!isAreaMode && (
                      <TableCell className="text-center">
                        {row.sottoscorta ? (
                          <Badge
                            variant="outline"
                            className="bg-amber-500 text-white border-amber-600"
                          >
                            {t("giacenze.statusSottoscorta")}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-green-500/10 text-green-700 border-none"
                          >
                            {t("giacenze.statusRegolare")}
                          </Badge>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
