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
import { useEffect } from "react";

export type ReportingFilterState = {
  da: string;
  a: string;
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
  magazzinoId: number | null;
  mensaId: number | null;
  zonaUdsId: number | null;
};

const ALL = "all";

export function reportingPeriodForYear(year: number, today = todayEuropeRome()) {
  return { da: `${year}-01-01`, a: year === Number(today.slice(0, 4)) ? today : `${year}-12-31` };
}

export function reconcileReportingFilterSelection(
  value: ReportingFilterState,
  options: { areeOperative: Array<{ id: number }>; centres: Array<{ id: number }>; warehouses: Array<{ id: number }>; mense: Array<{ id: number }>; zones: Array<{ id: number }> },
  locks: ReturnType<typeof getReportingFilterLocks>,
): Partial<ReportingFilterState> {
  const contains = (items: Array<{ id: number }>, selected: number | null) => selected == null || items.some((item) => item.id === selected);
  const patch: Partial<ReportingFilterState> = {};
  if (!locks.areaOperativaLocked && !contains(options.areeOperative, value.areaOperativaId)) return {
    areaOperativaId: null,
    centroAscoltoId: locks.centreLocked ? value.centroAscoltoId : null,
    magazzinoId: null,
    mensaId: null,
    zonaUdsId: locks.zoneLocked ? value.zonaUdsId : null,
  };
  if (!locks.centreLocked && !contains(options.centres, value.centroAscoltoId)) patch.centroAscoltoId = null;
  if (!contains(options.warehouses, value.magazzinoId)) patch.magazzinoId = null;
  if (!contains(options.mense, value.mensaId)) patch.mensaId = null;
  if (!locks.zoneLocked && !contains(options.zones, value.zonaUdsId)) patch.zonaUdsId = null;
  return patch;
}

export function getReportingFilterLocks(user: {
  areaOperativaId?: number | null;
  centroAscoltoId?: number | null;
  zonaUdsId?: number | null;
} | null) {
  return {
    areaOperativaLocked: user?.areaOperativaId != null,
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
  const { data: options, isLoading, isError } = useGetReportFilterOptions({
    section,
    areaOperativaId: value.areaOperativaId ?? undefined,
  });
  const areeOperative = options?.areeOperative ?? [];
  const centres = options?.centres ?? [];
  const warehouses = options?.warehouses ?? [];
  const mense = options?.mense ?? [];
  const zones = options?.zones ?? [];
  const { areaOperativaLocked, centreLocked, zoneLocked } = getReportingFilterLocks(user);
  const showWarehouse = ["generale", "pacchi", "emporio", "magazzino-logistica", "fse-plus"].includes(section);
  const showMensa = section === "mensa";
  const showZone = section === "uds";

  const update = (patch: Partial<ReportingFilterState>) => onChange({ ...value, ...patch });
  useEffect(() => {
    if (!options) return;
    const patch = reconcileReportingFilterSelection(value, options, { areaOperativaLocked, centreLocked, zoneLocked });
    const changed = (Object.keys(patch) as Array<keyof ReportingFilterState>)
      .some((key) => patch[key] !== value[key]);
    if (changed) onChange({ ...value, ...patch });
  }, [
    options,
    value.da,
    value.a,
    value.areaOperativaId,
    value.centroAscoltoId,
    value.magazzinoId,
    value.mensaId,
    value.zonaUdsId,
    areaOperativaLocked,
    centreLocked,
    zoneLocked,
    onChange,
  ]);
  const lockHint = (locked: boolean) => locked ? <p className="text-xs text-muted-foreground">{t("reporting.filters.lockedByRole")}</p> : null;
  const emptyHint = (count: number) => !isLoading && !isError && count === 0 ? <p className="text-xs text-muted-foreground">{t("reporting.filters.noOptions")}</p> : null;
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
                update(reportingPeriodForYear(year));
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
          <Label htmlFor="report-area-operativa">{t("reporting.filters.areaOperativa")}</Label>
          <Select
            value={value.areaOperativaId?.toString() ?? ALL}
            disabled={areaOperativaLocked}
            onValueChange={(next) => update({ areaOperativaId: next === ALL ? null : Number(next), centroAscoltoId: centreLocked ? value.centroAscoltoId : null, magazzinoId: null, mensaId: null, zonaUdsId: zoneLocked ? value.zonaUdsId : null })}
          >
            <SelectTrigger id="report-area-operativa"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reporting.filters.allAreeOperative")}</SelectItem>
              {areeOperative.map((areaOperativa) => <SelectItem key={areaOperativa.id} value={String(areaOperativa.id)}>{areaOperativa.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {lockHint(areaOperativaLocked)}{emptyHint(areeOperative.length)}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-centre">{t("reporting.filters.centre")}</Label>
          <Select value={value.centroAscoltoId?.toString() ?? ALL} disabled={centreLocked} onValueChange={(next) => update({ centroAscoltoId: next === ALL ? null : Number(next), magazzinoId: null, mensaId: null, zonaUdsId: zoneLocked ? value.zonaUdsId : null })}>
            <SelectTrigger id="report-centre"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reporting.filters.allCentres")}</SelectItem>
              {centres.map((centre) => <SelectItem key={centre.id} value={String(centre.id)}>{centre.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {lockHint(centreLocked)}{emptyHint(centres.length)}
        </div>
        {showWarehouse && (
          <div className="space-y-1.5">
            <Label htmlFor="report-warehouse">{t("reporting.filters.warehouse")}</Label>
            <Select value={value.magazzinoId?.toString() ?? ALL} onValueChange={(next) => update({ magazzinoId: next === ALL ? null : Number(next) })}>
              <SelectTrigger id="report-warehouse"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("reporting.filters.allWarehouses")}</SelectItem>
                {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {emptyHint(warehouses.length)}
          </div>
        )}
        {showMensa && (
          <div className="space-y-1.5">
            <Label htmlFor="report-mensa">{t("reporting.filters.mensa")}</Label>
            <Select value={value.mensaId?.toString() ?? ALL} onValueChange={(next) => update({ mensaId: next === ALL ? null : Number(next) })}>
              <SelectTrigger id="report-mensa"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("reporting.filters.allMense")}</SelectItem>
                {mense.map((mensa) => <SelectItem key={mensa.id} value={String(mensa.id)}>{mensa.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {emptyHint(mense.length)}
          </div>
        )}
        {showZone && (
          <div className="space-y-1.5">
            <Label htmlFor="report-zone">{t("reporting.filters.zone")}</Label>
            <Select value={value.zonaUdsId?.toString() ?? ALL} disabled={zoneLocked} onValueChange={(next) => update({ zonaUdsId: next === ALL ? null : Number(next) })}>
              <SelectTrigger id="report-zone"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("reporting.filters.allZones")}</SelectItem>
                {zones.map((zone) => <SelectItem key={zone.id} value={String(zone.id)}>{zone.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {lockHint(zoneLocked)}{emptyHint(zones.length)}
          </div>
        )}
        {isError && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-5" role="alert">{t("reporting.filters.optionsError")}</p>}
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">{t("reporting.filters.appliedPeriod", { from: value.da, to: value.a })}</p>
      </CardContent>
    </Card>
  );
}
