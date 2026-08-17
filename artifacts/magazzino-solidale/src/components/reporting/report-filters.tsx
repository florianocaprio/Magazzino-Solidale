import {
  useGetReportFilterOptions,
  type GetReportFilterOptionsSection,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { todayEuropeRome } from "@/lib/europe-rome";

export type ReportingFilterState = {
  da: string;
  a: string;
  cittaId: number | null;
  centroAscoltoId: number | null;
  magazzinoId: number | null;
  mensaId: number | null;
  zonaUdsId: number | null;
};

const ALL = "all";

export function getReportingFilterLocks(user: {
  cittaId?: number | null;
  centroAscoltoId?: number | null;
  zonaUdsId?: number | null;
} | null) {
  return {
    cityLocked: user?.cittaId != null,
    centreLocked: user?.centroAscoltoId != null,
    zoneLocked: user?.zonaUdsId != null,
  };
}

export function ReportFilters({
  section,
  value,
  onChange,
}: {
  section: GetReportFilterOptionsSection;
  value: ReportingFilterState;
  onChange: (value: ReportingFilterState) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: options } = useGetReportFilterOptions({
    section,
    cittaId: value.cittaId ?? undefined,
  });
  const cities = options?.cities ?? [];
  const centres = options?.centres ?? [];
  const warehouses = options?.warehouses ?? [];
  const mense = options?.mense ?? [];
  const zones = options?.zones ?? [];
  const { cityLocked, centreLocked, zoneLocked } = getReportingFilterLocks(user);
  const showWarehouse = ["generale", "pacchi", "emporio", "magazzino-logistica", "fse-plus"].includes(section);
  const showMensa = section === "mensa";
  const showZone = section === "uds";

  const update = (patch: Partial<ReportingFilterState>) => onChange({ ...value, ...patch });
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-5">
        {section === "fse-plus" ? (
          <div className="space-y-1.5">
            <Label htmlFor="report-anno">{t("reporting.filters.year")}</Label>
            <Input
              id="report-anno"
              type="number"
              min={2000}
              max={2100}
              value={value.a.slice(0, 4)}
              onChange={(event) => {
                const year = Number(event.target.value);
                if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
                const today = todayEuropeRome();
                update({ da: `${year}-01-01`, a: year === Number(today.slice(0, 4)) ? today : `${year}-12-31` });
              }}
            />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="report-da">{t("reporting.filters.from")}</Label>
              <Input id="report-da" type="date" value={value.da} max={value.a} onChange={(event) => update({ da: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-a">{t("reporting.filters.to")}</Label>
              <Input id="report-a" type="date" value={value.a} min={value.da} onChange={(event) => update({ a: event.target.value })} />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label>{t("reporting.filters.city")}</Label>
          <Select
            value={value.cittaId?.toString() ?? ALL}
            disabled={cityLocked}
            onValueChange={(next) => update({ cittaId: next === ALL ? null : Number(next), centroAscoltoId: centreLocked ? value.centroAscoltoId : null, magazzinoId: null, mensaId: null, zonaUdsId: zoneLocked ? value.zonaUdsId : null })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reporting.filters.allCities")}</SelectItem>
              {cities.map((city) => <SelectItem key={city.id} value={String(city.id)}>{city.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("reporting.filters.centre")}</Label>
          <Select value={value.centroAscoltoId?.toString() ?? ALL} disabled={centreLocked} onValueChange={(next) => update({ centroAscoltoId: next === ALL ? null : Number(next) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reporting.filters.allCentres")}</SelectItem>
              {centres.map((centre) => <SelectItem key={centre.id} value={String(centre.id)}>{centre.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {showWarehouse && (
          <div className="space-y-1.5">
            <Label>{t("reporting.filters.warehouse")}</Label>
            <Select value={value.magazzinoId?.toString() ?? ALL} onValueChange={(next) => update({ magazzinoId: next === ALL ? null : Number(next) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("reporting.filters.allWarehouses")}</SelectItem>
                {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showMensa && (
          <div className="space-y-1.5">
            <Label>{t("reporting.filters.mensa")}</Label>
            <Select value={value.mensaId?.toString() ?? ALL} onValueChange={(next) => update({ mensaId: next === ALL ? null : Number(next) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("reporting.filters.allMense")}</SelectItem>
                {mense.map((mensa) => <SelectItem key={mensa.id} value={String(mensa.id)}>{mensa.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showZone && (
          <div className="space-y-1.5">
            <Label>{t("reporting.filters.zone")}</Label>
            <Select value={value.zonaUdsId?.toString() ?? ALL} disabled={zoneLocked} onValueChange={(next) => update({ zonaUdsId: next === ALL ? null : Number(next) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("reporting.filters.allZones")}</SelectItem>
                {zones.map((zone) => <SelectItem key={zone.id} value={String(zone.id)}>{zone.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
