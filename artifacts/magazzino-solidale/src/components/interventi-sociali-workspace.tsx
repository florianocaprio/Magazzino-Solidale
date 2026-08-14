import type {
  Intervento,
  InterventoOperatore,
  InterventiRiepilogoViste,
} from "@workspace/api-client-react";
import { CalendarDays, List, RotateCcw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InterventoAvvisoBadge } from "@/components/intervento-avviso";
import { InterventoStatoBadge } from "@/components/intervento-workflow";
import { InterventiSocialiCalendar } from "@/components/interventi-sociali-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { civilDateEuropeRome, timeEuropeRome } from "@/lib/europe-rome";
import {
  INTERVENTI_SOCIALI_VISTE,
  type InterventiSocialiFilters,
  type InterventiSocialiVista,
} from "@/lib/interventi-sociali-filters";
import { cn } from "@/lib/utils";

interface NamedOption {
  id: number;
  nome: string;
  cittaId?: number | null;
  attivo?: boolean;
}

interface Props {
  filters: InterventiSocialiFilters;
  interventi: Intervento[];
  counts?: InterventiRiepilogoViste;
  citta: NamedOption[];
  centri: NamedOption[];
  tipi: NamedOption[];
  operatori: InterventoOperatore[];
  isGlobal: boolean;
  isCentroLocked: boolean;
  cityRequired?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  onFiltersChange: (next: InterventiSocialiFilters) => void;
  onReset: () => void;
  onOpenIntervento: (intervento: Intervento) => void;
}

const COUNT_KEYS: Record<
  InterventiSocialiVista,
  keyof InterventiRiepilogoViste
> = {
  da_pianificare: "daPianificare",
  pianificati: "pianificati",
  oggi: "oggi",
  in_corso: "inCorso",
  conclusi: "conclusi",
  annullati: "annullati",
};

function timestampLabel(value?: string | null): string {
  if (!value) return "–";
  return `${civilDateEuropeRome(value).split("-").reverse().join("/")} ${timeEuropeRome(value)}`;
}

function actualDate(intervento: Intervento): string {
  if (intervento.dataOraConclusione)
    return timestampLabel(intervento.dataOraConclusione);
  if (intervento.dataOraAvvio) return timestampLabel(intervento.dataOraAvvio);
  return intervento.dataIntervento
    ? intervento.dataIntervento.split("-").reverse().join("/")
    : "–";
}

function InterventoPriority({ value }: { value: Intervento["priorita"] }) {
  const { t } = useTranslation();
  const classes = {
    urgente: "border-red-300 bg-red-50 text-red-800",
    alta: "border-orange-300 bg-orange-50 text-orange-800",
    normale: "border-blue-200 bg-blue-50 text-blue-800",
    bassa: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <Badge className={classes[value]} variant="outline">
      {t(`interventi.priorita.${value}`)}
    </Badge>
  );
}

function LegacyBadge({ legacy }: { legacy: boolean }) {
  const { t } = useTranslation();
  return legacy ? (
    <Badge variant="outline">{t("interventi.legacy.label")}</Badge>
  ) : null;
}

export function InterventiSocialiWorkspace({
  filters,
  interventi,
  counts,
  citta,
  centri,
  tipi,
  operatori,
  isGlobal,
  isCentroLocked,
  cityRequired = false,
  isLoading = false,
  isError = false,
  onFiltersChange,
  onReset,
  onOpenIntervento,
}: Props) {
  const { t } = useTranslation();
  const update = <Key extends keyof InterventiSocialiFilters>(
    key: Key,
    value: InterventiSocialiFilters[Key],
  ) => onFiltersChange({ ...filters, [key]: value });
  const calendarAvailable =
    filters.vista === "pianificati" || filters.vista === "oggi";
  const filteredCenters = centri.filter(
    (centro) =>
      !filters.cittaId ||
      centro.cittaId == null ||
      String(centro.cittaId) === filters.cittaId,
  );

  const renderResults = () => {
    if (cityRequired) {
      return (
        <p className="py-12 text-center text-muted-foreground">
          {t("interventi.filters.chooseCity")}
        </p>
      );
    }
    if (isLoading) {
      return (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      );
    }
    if (isError) {
      return (
        <p role="alert" className="py-12 text-center text-destructive">
          {t("interventi.errorState")}
        </p>
      );
    }
    if (filters.modo === "calendario" && calendarAvailable) {
      return (
        <div className="p-4">
          <InterventiSocialiCalendar
            month={filters.mese}
            selectedDate={filters.giorno}
            interventi={interventi}
            onMonthChange={(mese) => onFiltersChange({ ...filters, mese })}
            onSelectDate={(giorno) =>
              onFiltersChange({ ...filters, giorno, mese: giorno.slice(0, 7) })
            }
            onOpenIntervento={onOpenIntervento}
          />
        </div>
      );
    }
    if (interventi.length === 0) {
      return (
        <p className="py-12 text-center text-muted-foreground">
          {t("interventi.emptyView")}
        </p>
      );
    }
    return (
      <>
        <div
          className="hidden overflow-x-auto md:block"
          data-testid="interventi-desktop-list"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("interventi.beneficiario")}</TableHead>
                <TableHead>{t("interventi.list.planned")}</TableHead>
                <TableHead>{t("interventi.list.actual")}</TableHead>
                <TableHead>{t("interventi.tipoIntervento")}</TableHead>
                <TableHead>{t("interventi.detail.state")}</TableHead>
                <TableHead>{t("interventi.detail.priority")}</TableHead>
                <TableHead>{t("interventi.detail.center")}</TableHead>
                <TableHead>{t("interventi.operatore")}</TableHead>
                <TableHead>{t("common.description")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {interventi.map((intervento) => (
                <TableRow
                  key={intervento.id}
                  tabIndex={0}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => onOpenIntervento(intervento)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenIntervento(intervento);
                    }
                  }}
                >
                  <TableCell>
                    <p className="font-medium">{intervento.beneficiarioNome}</p>
                    <p className="text-xs text-muted-foreground">
                      {intervento.beneficiarioCodice}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {intervento.nucleoFamiliareSintesi}
                    </p>
                    <LegacyBadge legacy={intervento.ambitoLegacy} />
                  </TableCell>
                  <TableCell>
                    {timestampLabel(intervento.dataOraPianificata)}
                  </TableCell>
                  <TableCell>{actualDate(intervento)}</TableCell>
                  <TableCell>{intervento.tipoIntervento}</TableCell>
                  <TableCell>
                    <InterventoStatoBadge stato={intervento.stato} />
                  </TableCell>
                  <TableCell>
                    <InterventoPriority value={intervento.priorita} />
                    <InterventoAvvisoBadge
                      avviso={intervento.avviso}
                      className="ml-1"
                    />
                  </TableCell>
                  <TableCell>
                    <p>{intervento.sede || "–"}</p>
                    <p className="text-xs text-muted-foreground">
                      {intervento.centroAscoltoNome}
                    </p>
                  </TableCell>
                  <TableCell>
                    {intervento.operatoreNome ??
                      intervento.operatoreCodice ??
                      "–"}
                  </TableCell>
                  <TableCell className="max-w-64">
                    <p
                      className="truncate"
                      title={intervento.descrizione ?? undefined}
                    >
                      {intervento.descrizione || "–"}
                    </p>
                    {(intervento.interventoPrecedenteId ||
                      intervento.numeroSuccessori > 0) && (
                      <p className="text-xs text-muted-foreground">
                        {intervento.interventoPrecedenteId
                          ? t("interventi.list.previous", {
                              id: intervento.interventoPrecedenteId,
                            })
                          : ""}
                        {intervento.numeroSuccessori > 0
                          ? ` · ${t("interventi.list.following", { count: intervento.numeroSuccessori })}`
                          : ""}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div
          className="space-y-3 p-3 md:hidden"
          data-testid="interventi-mobile-list"
        >
          {interventi.map((intervento) => (
            <button
              key={intervento.id}
              type="button"
              onClick={() => onOpenIntervento(intervento)}
              className="w-full rounded-lg border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{intervento.beneficiarioNome}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      intervento.beneficiarioCodice,
                      intervento.nucleoFamiliareSintesi,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <InterventoStatoBadge stato={intervento.stato} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <InterventoPriority value={intervento.priorita} />
                <InterventoAvvisoBadge avviso={intervento.avviso} />
                <LegacyBadge legacy={intervento.ambitoLegacy} />
                <Badge variant="secondary">{intervento.tipoIntervento}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-1 text-sm">
                <dt className="text-muted-foreground">
                  {t("interventi.list.planned")}
                </dt>
                <dd>{timestampLabel(intervento.dataOraPianificata)}</dd>
                <dt className="text-muted-foreground">
                  {t("interventi.list.actual")}
                </dt>
                <dd>{actualDate(intervento)}</dd>
                <dt className="text-muted-foreground">
                  {t("interventi.detail.site")}
                </dt>
                <dd>{intervento.sede || "–"}</dd>
                <dt className="text-muted-foreground">
                  {t("interventi.operatore")}
                </dt>
                <dd>
                  {intervento.operatoreNome ??
                    intervento.operatoreCodice ??
                    "–"}
                </dd>
                <dt className="text-muted-foreground">
                  {t("interventi.detail.center")}
                </dt>
                <dd>{intervento.centroAscoltoNome || "–"}</dd>
              </dl>
              {intervento.descrizione && (
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                  {intervento.descrizione}
                </p>
              )}
              {(intervento.interventoPrecedenteId ||
                intervento.numeroSuccessori > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {intervento.interventoPrecedenteId
                    ? t("interventi.list.previous", {
                        id: intervento.interventoPrecedenteId,
                      })
                    : ""}
                  {intervento.numeroSuccessori > 0
                    ? ` · ${t("interventi.list.following", { count: intervento.numeroSuccessori })}`
                    : ""}
                </p>
              )}
            </button>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t("interventi.views.selector")}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
      >
        {INTERVENTI_SOCIALI_VISTE.map((vista) => (
          <button
            key={vista}
            type="button"
            role="tab"
            aria-selected={filters.vista === vista}
            onClick={() =>
              onFiltersChange({
                ...filters,
                vista,
                modo:
                  (vista === "pianificati" || vista === "oggi") &&
                  filters.modo === "calendario"
                    ? "calendario"
                    : "elenco",
                stato: "",
              })
            }
            className={cn(
              "rounded-lg border px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filters.vista === vista
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-accent",
            )}
          >
            <span className="block font-medium">
              {t(`interventi.views.${vista}`)}
            </span>
            <span
              className={cn(
                "mt-1 block text-lg font-bold",
                filters.vista !== vista && "text-foreground",
              )}
            >
              {counts?.[COUNT_KEYS[vista]] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={filters.ricerca}
                onChange={(event) => update("ricerca", event.target.value)}
                placeholder={t("interventi.filters.search")}
                className="pl-9"
                aria-label={t("interventi.filters.search")}
              />
            </div>
            {isGlobal && (
              <Select
                value={filters.cittaId || "all"}
                onValueChange={(value) =>
                  onFiltersChange({
                    ...filters,
                    cittaId: value === "all" ? "" : value,
                    centroAscoltoId: "",
                  })
                }
              >
                <SelectTrigger aria-label={t("interventi.filters.city")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("interventi.filters.chooseCity")}
                  </SelectItem>
                  {citta.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={filters.centroAscoltoId || "all"}
              onValueChange={(value) =>
                update("centroAscoltoId", value === "all" ? "" : value)
              }
              disabled={isCentroLocked || (isGlobal && !filters.cittaId)}
            >
              <SelectTrigger aria-label={t("interventi.filters.center")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("interventi.filterAllCenters")}
                </SelectItem>
                {filteredCenters.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.tipo || "all"}
              onValueChange={(value) =>
                update("tipo", value === "all" ? "" : value)
              }
            >
              <SelectTrigger aria-label={t("interventi.filters.type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("interventi.filterAllTypes")}
                </SelectItem>
                {tipi
                  .filter((item) => item.attivo !== false)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.nome}>
                      {item.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.priorita || "all"}
              onValueChange={(value) =>
                update("priorita", value === "all" ? "" : value)
              }
            >
              <SelectTrigger aria-label={t("interventi.filters.priority")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("interventi.filters.allPriorities")}
                </SelectItem>
                {(["urgente", "alta", "normale", "bassa"] as const).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {t(`interventi.priorita.${value}`)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select
              value={filters.operatoreId || "all"}
              onValueChange={(value) =>
                update("operatoreId", value === "all" ? "" : value)
              }
            >
              <SelectTrigger aria-label={t("interventi.filters.operator")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("interventi.filters.allOperators")}
                </SelectItem>
                {operatori.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.ambitoLegacy}
              onValueChange={(value) =>
                update(
                  "ambitoLegacy",
                  value as InterventiSocialiFilters["ambitoLegacy"],
                )
              }
            >
              <SelectTrigger aria-label={t("interventi.filters.legacy")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">
                  {t("interventi.legacy.all")}
                </SelectItem>
                <SelectItem value="classificati">
                  {t("interventi.legacy.classified")}
                </SelectItem>
                <SelectItem value="legacy">
                  {t("interventi.legacy.only")}
                </SelectItem>
              </SelectContent>
            </Select>
            {filters.vista === "annullati" && (
              <Select
                value={filters.stato || "all"}
                onValueChange={(value) =>
                  update("stato", value === "all" ? "" : value)
                }
              >
                <SelectTrigger aria-label={t("interventi.filters.state")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("interventi.filters.allStates")}
                  </SelectItem>
                  <SelectItem value="annullato">
                    {t("interventi.workflowStati.annullato")}
                  </SelectItem>
                  <SelectItem value="mancata_presentazione">
                    {t("interventi.workflowStati.mancata_presentazione")}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <Input
              type="date"
              value={filters.da}
              onChange={(event) => update("da", event.target.value)}
              aria-label={t("interventi.filters.from")}
            />
            <Input
              type="date"
              value={filters.a}
              onChange={(event) => update("a", event.target.value)}
              aria-label={t("interventi.filters.to")}
            />
            <Select
              value={filters.ordina}
              onValueChange={(value) =>
                update("ordina", value as InterventiSocialiFilters["ordina"])
              }
            >
              <SelectTrigger aria-label={t("interventi.filters.order")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {t("interventi.filters.defaultOrder")}
                </SelectItem>
                {(
                  ["data", "priorita", "beneficiario", "operatore"] as const
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`interventi.filters.orderValues.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.direzione}
              onValueChange={(value) =>
                update("direzione", value as "asc" | "desc")
              }
            >
              <SelectTrigger aria-label={t("interventi.filters.direction")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">
                  {t("interventi.filters.asc")}
                </SelectItem>
                <SelectItem value="desc">
                  {t("interventi.filters.desc")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" /> {t("interventi.filters.reset")}
            </Button>
            {calendarAvailable && (
              <div
                className="flex rounded-md border p-1"
                aria-label={t("interventi.displayMode")}
              >
                <Button
                  type="button"
                  size="sm"
                  variant={filters.modo === "elenco" ? "default" : "ghost"}
                  onClick={() => update("modo", "elenco")}
                  aria-pressed={filters.modo === "elenco"}
                >
                  <List className="mr-2 h-4 w-4" /> {t("interventi.listMode")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={filters.modo === "calendario" ? "default" : "ghost"}
                  onClick={() => update("modo", "calendario")}
                  aria-pressed={filters.modo === "calendario"}
                >
                  <CalendarDays className="mr-2 h-4 w-4" />{" "}
                  {t("interventi.calendarMode")}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">{renderResults()}</CardContent>
      </Card>
    </div>
  );
}
