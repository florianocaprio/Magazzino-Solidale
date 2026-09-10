import type { AreaOperativa, Magazzino } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

export function activeOperationalAreas(
  areas: AreaOperativa[] | undefined,
): AreaOperativa[] {
  return (areas ?? []).filter((area) => area.attivo);
}

export function operationalWarehousesForArea(
  warehouses: Magazzino[] | undefined,
  areaOperativaId: number | null,
): Magazzino[] {
  if (areaOperativaId == null) return [];
  return (warehouses ?? []).filter(
    (warehouse) =>
      warehouse.areaOperativaId === areaOperativaId &&
      warehouse.stato === "attivo",
  );
}

export function AreaMagazzinoSelector({
  areas,
  warehouses,
  areaId,
  warehouseId,
  onAreaChange,
  onWarehouseChange,
}: {
  areas: AreaOperativa[];
  warehouses: Magazzino[];
  areaId: string;
  warehouseId: string;
  onAreaChange: (value: string) => void;
  onWarehouseChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="area-operativa-giacenze">
          {t("giacenze.areaOperativa")}
        </Label>
        <Select value={areaId || undefined} onValueChange={onAreaChange}>
          <SelectTrigger
            id="area-operativa-giacenze"
            className="w-[240px]"
            aria-label={t("giacenze.areaOperativa")}
          >
            <SelectValue placeholder={t("giacenze.selectArea")} />
          </SelectTrigger>
          <SelectContent>
            {areas.map((area) => (
              <SelectItem key={area.id} value={String(area.id)}>
                {area.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="magazzino-giacenze">{t("giacenze.warehouse")}</Label>
        <Select
          value={warehouseId}
          onValueChange={onWarehouseChange}
          disabled={!areaId}
        >
          <SelectTrigger
            id="magazzino-giacenze"
            className="w-[240px]"
            aria-label={t("giacenze.warehouse")}
          >
            <SelectValue placeholder={t("giacenze.allAreaWarehouses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("giacenze.allAreaWarehouses")}
            </SelectItem>
            {warehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                {warehouse.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
