import { useMemo, useState } from "react";
import {
  getListSuperAdminLogSistemaQueryKey,
  SystemLogEventStatus,
  SystemLogEventType,
  useListSuperAdminLogSistema,
  type ListSuperAdminLogSistemaParams,
  type SystemLogEntry,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 25;
const ALL = "__all__";
const EVENT_TYPES = Object.values(SystemLogEventType);
const EVENT_STATUSES = Object.values(SystemLogEventStatus);
const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "link",
  "mailpassword",
  "password",
  "reseturl",
  "secret",
  "token",
] as const;

function isSensitiveKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

function shortText(value: string, max = 80) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function safeValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return shortText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return shortText(value.map((item) => safeValue(item)).filter(Boolean).join(", "));
  }
  if (typeof value === "object") {
    return shortText(
      Object.entries(value)
        .filter(([key]) => !isSensitiveKey(key))
        .map(([key, raw]) => `${key}: ${safeValue(raw)}`)
        .filter(Boolean)
        .join(", "),
    );
  }
  return "";
}

function detailSummary(row: SystemLogEntry) {
  const parts: string[] = [];
  if (row.note) parts.push(row.note);
  if (row.details) {
    for (const [key, value] of Object.entries(row.details)) {
      if (isSensitiveKey(key)) continue;
      const formatted = safeValue(value);
      if (formatted) parts.push(`${key}: ${formatted}`);
      if (parts.length >= 4) break;
    }
  }
  return parts.length > 0 ? parts.join(" | ") : "—";
}

function statusClass(status: string) {
  if (status === "SUCCESS") return "bg-emerald-500/10 text-emerald-700";
  if (status === "FAILED") return "bg-red-500/10 text-red-700";
  if (status === "WARNING") return "bg-amber-500/10 text-amber-700";
  return "bg-sky-500/10 text-sky-700";
}

function fmtDate(value: string) {
  return new Date(value).toLocaleString("it-IT");
}

function fmtMaybe(value: string | number | null | undefined) {
  return value == null || value === "" ? "—" : String(value);
}

export default function SuperAdminLogSistema() {
  const { t } = useTranslation();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState(ALL);
  const [eventStatus, setEventStatus] = useState(ALL);
  const [ipAddress, setIpAddress] = useState("");
  const [page, setPage] = useState(0);

  const params = useMemo<ListSuperAdminLogSistemaParams>(() => {
    const query: ListSuperAdminLogSistemaParams = {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    if (dateFrom) query.dateFrom = dateFrom;
    if (dateTo) query.dateTo = dateTo;
    if (search.trim()) query.search = search.trim();
    if (eventType !== ALL) query.eventType = eventType as ListSuperAdminLogSistemaParams["eventType"];
    if (eventStatus !== ALL) query.eventStatus = eventStatus as ListSuperAdminLogSistemaParams["eventStatus"];
    if (ipAddress.trim()) query.ipAddress = ipAddress.trim();
    return query;
  }, [dateFrom, dateTo, eventStatus, eventType, ipAddress, page, search]);

  const query = useListSuperAdminLogSistema(params, {
    query: { queryKey: getListSuperAdminLogSistemaQueryKey(params) },
  });

  const data = query.data;
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (data?.offset ?? 0) + 1;
  const to = Math.min((data?.offset ?? 0) + (data?.limit ?? PAGE_SIZE), total);
  const hasPrevious = page > 0;
  const hasNext = to < total;

  const resetFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setEventType(ALL);
    setEventStatus(ALL);
    setIpAddress("");
    setPage(0);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("logSistema.title")}</h1>
        <p className="text-muted-foreground">{t("logSistema.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("logSistema.filtersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-2">
              <Label htmlFor="system-log-date-from">{t("logSistema.dateFrom")}</Label>
              <Input
                id="system-log-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="system-log-date-to">{t("logSistema.dateTo")}</Label>
              <Input
                id="system-log-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="system-log-search">{t("logSistema.search")}</Label>
              <Input
                id="system-log-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder={t("logSistema.searchPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("logSistema.eventType")}</Label>
              <Select
                value={eventType}
                onValueChange={(value) => {
                  setEventType(value);
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("logSistema.allEvents")}</SelectItem>
                  {EVENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`logSistema.events.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("logSistema.eventStatus")}</Label>
              <Select
                value={eventStatus}
                onValueChange={(value) => {
                  setEventStatus(value);
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("logSistema.allStatuses")}</SelectItem>
                  {EVENT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`logSistema.statuses.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="system-log-ip">{t("logSistema.ipAddress")}</Label>
              <Input
                id="system-log-ip"
                value={ipAddress}
                onChange={(e) => {
                  setIpAddress(e.target.value);
                  setPage(0);
                }}
                placeholder={t("logSistema.ipPlaceholder")}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" onClick={resetFilters}>
              {t("logSistema.resetFilters")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : query.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("logSistema.loadError")}</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("logSistema.noResults")}
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{t("logSistema.results", { from, to, total })}</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasPrevious || query.isFetching}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  {t("logSistema.previousPage")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasNext || query.isFetching}
                  onClick={() => setPage((value) => value + 1)}
                >
                  {t("logSistema.nextPage")}
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("logSistema.columns.dateTime")}</TableHead>
                    <TableHead>{t("logSistema.columns.user")}</TableHead>
                    <TableHead>{t("logSistema.columns.email")}</TableHead>
                    <TableHead>{t("logSistema.columns.event")}</TableHead>
                    <TableHead>{t("logSistema.columns.status")}</TableHead>
                    <TableHead>{t("logSistema.columns.ip")}</TableHead>
                    <TableHead>{t("logSistema.columns.userAgent")}</TableHead>
                    <TableHead>{t("logSistema.columns.detail")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{fmtDate(row.createdAt)}</TableCell>
                      <TableCell>{fmtMaybe(row.username ?? row.actorUserId ?? row.targetUserId)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtMaybe(row.userEmail)}</TableCell>
                      <TableCell>{t(`logSistema.events.${row.eventType}`)}</TableCell>
                      <TableCell>
                        <Badge className={statusClass(row.eventStatus)}>
                          {t(`logSistema.statuses.${row.eventStatus}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtMaybe(row.ipAddress)}</TableCell>
                      <TableCell className="max-w-[220px] text-muted-foreground">
                        {row.userAgent ? shortText(row.userAgent, 90) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[320px] text-sm text-muted-foreground">
                        {detailSummary(row)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
