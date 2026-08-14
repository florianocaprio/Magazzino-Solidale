import type { Intervento } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  civilDateEuropeRome,
  shiftMonth,
  timeEuropeRome,
  todayEuropeRome,
} from "@/lib/europe-rome";
import { cn } from "@/lib/utils";

interface Props {
  month: string;
  selectedDate: string;
  interventi: Intervento[];
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
  onOpenIntervento: (intervento: Intervento) => void;
}

export function calendarCells(month: string): string[] {
  const [year, numericMonth] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, numericMonth - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(
      Date.UTC(year, numericMonth - 1, 1 - mondayOffset + index),
    );
    return `${cell.getUTCFullYear()}-${String(cell.getUTCMonth() + 1).padStart(2, "0")}-${String(cell.getUTCDate()).padStart(2, "0")}`;
  });
}

export function interventoCalendarDate(intervento: Intervento): string | null {
  const timestamp = intervento.dataOraPianificata ?? intervento.dataOraAvvio;
  return timestamp ? civilDateEuropeRome(timestamp) : null;
}

function EventButton({
  intervento,
  onOpen,
}: {
  intervento: Intervento;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const timestamp = intervento.dataOraPianificata ?? intervento.dataOraAvvio;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="w-full rounded border bg-background p-1 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("interventi.calendar.openEvent", {
        name: intervento.beneficiarioNome ?? "",
      })}
    >
      <span className="font-semibold">
        {timestamp ? timeEuropeRome(timestamp) : "–"} ·{" "}
        {intervento.beneficiarioNome}
      </span>
      <span className="block truncate text-muted-foreground">
        {intervento.tipoIntervento}
      </span>
      <span className="mt-1 flex flex-wrap gap-1">
        <Badge variant="secondary" className="px-1 py-0 text-[10px]">
          {t(`interventi.workflowStati.${intervento.stato}`)}
        </Badge>
        <Badge variant="outline" className="px-1 py-0 text-[10px]">
          {t(`interventi.priorita.${intervento.priorita}`)}
        </Badge>
      </span>
    </button>
  );
}

export function InterventiSocialiCalendar({
  month,
  selectedDate,
  interventi,
  onMonthChange,
  onSelectDate,
  onOpenIntervento,
}: Props) {
  const { t, i18n } = useTranslation();
  const today = todayEuropeRome();
  const cells = useMemo(() => calendarCells(month), [month]);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, Intervento[]>();
    for (const intervento of interventi) {
      const date = interventoCalendarDate(intervento);
      if (!date) continue;
      const current = grouped.get(date) ?? [];
      current.push(intervento);
      grouped.set(date, current);
    }
    for (const rows of grouped.values()) {
      rows.sort((left, right) =>
        (left.dataOraPianificata ?? left.dataOraAvvio ?? "").localeCompare(
          right.dataOraPianificata ?? right.dataOraAvvio ?? "",
        ),
      );
    }
    return grouped;
  }, [interventi]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const [year, numericMonth] = month.split("-").map(Number);
  const monthLabel = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, numericMonth - 1, 1)));
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 7, 3 + index))),
  );

  const goToday = () => {
    onSelectDate(today);
  };

  return (
    <div className="space-y-4" data-testid="interventi-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("interventi.calendar.previousMonth")}
            onClick={() => onMonthChange(shiftMonth(month, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("interventi.calendar.nextMonth")}
            onClick={() => onMonthChange(shiftMonth(month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" onClick={goToday}>
            {t("interventi.views.oggi")}
          </Button>
        </div>
        <h2 className="text-lg font-semibold capitalize" aria-live="polite">
          {monthLabel}
        </h2>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {weekdays.map((weekday) => (
          <div
            key={weekday}
            className="bg-muted p-2 text-center text-xs font-medium uppercase"
          >
            {weekday}
          </div>
        ))}
        {cells.map((date) => {
          const events = eventsByDate.get(date) ?? [];
          const inMonth = date.startsWith(month);
          return (
            <div
              key={date}
              className={cn(
                "min-h-16 bg-background p-1 text-left align-top md:min-h-28 md:p-2",
                !inMonth && "text-muted-foreground opacity-60",
                selectedDate === date && "ring-2 ring-inset ring-primary",
                today === date && "bg-primary/5",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDate(date)}
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  today === date && "bg-primary text-primary-foreground",
                )}
                aria-pressed={selectedDate === date}
                aria-label={date}
              >
                {Number(date.slice(-2))}
              </button>
              <div className="mt-1 hidden space-y-1 md:block">
                {events.slice(0, 3).map((intervento) => (
                  <EventButton
                    key={intervento.id}
                    intervento={intervento}
                    onOpen={() => onOpenIntervento(intervento)}
                  />
                ))}
                {events.length > 3 && (
                  <Badge variant="secondary">
                    {t("interventi.calendar.more", {
                      count: events.length - 3,
                    })}
                  </Badge>
                )}
              </div>
              {events.length > 0 && (
                <span className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full bg-primary md:hidden" />
              )}
            </div>
          );
        })}
      </div>

      <section
        className="space-y-2 md:hidden"
        data-testid="calendar-mobile-agenda"
      >
        <h3 className="font-semibold">
          {t("interventi.calendar.agendaDate", { date: selectedDate })}
        </h3>
        {selectedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("interventi.calendar.emptyDay")}
          </p>
        ) : (
          selectedEvents.map((intervento) => (
            <EventButton
              key={intervento.id}
              intervento={intervento}
              onOpen={() => onOpenIntervento(intervento)}
            />
          ))
        )}
      </section>
    </div>
  );
}
