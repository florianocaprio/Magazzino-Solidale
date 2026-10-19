import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getListEntiDestinatariQueryKey,
  useCreateEnteDestinatario,
  useListAreeOperative,
  useListEntiDestinatari,
  useUpdateEnteDestinatario,
  type EnteDestinatario,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import { bollaErrorMessage } from "@/lib/bolla-query-invalidation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type EnteForm = {
  denominazione: string;
  indirizzo: string;
  telefono: string;
  email: string;
  areaOperativaId: string;
};

const emptyForm = (areaOperativaId?: number | null): EnteForm => ({
  denominazione: "",
  indirizzo: "",
  telefono: "",
  email: "",
  areaOperativaId: areaOperativaId == null ? "" : String(areaOperativaId),
});

export default function EntiEsterni() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const intents = useCommandIntentRegistry();
  const create = useCreateEnteDestinatario();
  const update = useUpdateEnteDestinatario();
  const globalAdmin = Boolean(user?.isAdmin && user.areaOperativaId == null);
  const [areaFilter, setAreaFilter] = useState(
    String(user?.areaOperativaId ?? "all"),
  );
  const canManage =
    hasPermission("enti-destinatari.manage") &&
    (user?.isAdmin ||
      (user?.aree?.includes("sociale") && user.areaOperativaId != null));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EnteDestinatario | null>(null);
  const [form, setForm] = useState<EnteForm>(() =>
    emptyForm(user?.areaOperativaId),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 275);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const params = {
    attivo: false,
    limit: 50,
    offset,
    ...(areaFilter === "global"
      ? { ambito: "globali" as const }
      : areaFilter !== "all"
        ? { areaOperativaId: Number(areaFilter) }
        : {}),
    ...(debouncedSearch.length >= 2 ? { search: debouncedSearch } : {}),
  };
  const searchReady =
    search.trim().length === 0 ||
    (search.trim().length >= 2 && debouncedSearch === search.trim());
  const list = useListEntiDestinatari(params, {
    query: {
      queryKey: getListEntiDestinatariQueryKey(params),
      enabled: searchReady,
    },
  });
  const { data: areas } = useListAreeOperative();
  const areaNames = new Map(areas?.map((area) => [area.id, area.nome]) ?? []);
  const setField = (field: keyof EnteForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const beginCreate = () => {
    setEditing(null);
    setForm(emptyForm(user?.areaOperativaId));
    setError("");
    setOpen(true);
  };
  const beginEdit = (item: EnteDestinatario) => {
    setEditing(item);
    setForm({
      denominazione: item.denominazione,
      indirizzo: item.indirizzo,
      telefono: item.telefono ?? "",
      email: item.email ?? "",
      areaOperativaId:
        item.areaOperativaId == null ? "global" : String(item.areaOperativaId),
    });
    setError("");
    setOpen(true);
  };
  const invalidate = () => {
    setOffset(0);
    return queryClient.invalidateQueries({
      queryKey: getListEntiDestinatariQueryKey(),
    });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const areaOperativaId = globalAdmin
      ? form.areaOperativaId === "global"
        ? null
        : Number(form.areaOperativaId)
      : user?.areaOperativaId;
    if (
      !form.denominazione.trim() ||
      !form.indirizzo.trim() ||
      (areaOperativaId !== null &&
        (!areaOperativaId || !Number.isSafeInteger(areaOperativaId)))
    ) {
      setError(t("entiEsterni.required"));
      return;
    }
    const values = {
      denominazione: form.denominazione.trim(),
      indirizzo: form.indirizzo.trim(),
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
    };
    const slot = editing ? `ente:${editing.id}:update` : "ente:create";
    try {
      if (editing) {
        const payload = { ...values, versione: editing.versione };
        await update.mutateAsync({
          id: editing.id,
          data: intents.prepare(slot, payload, payload),
        });
      } else {
        const payload = { ...values, areaOperativaId };
        await create.mutateAsync({
          data: intents.prepare(slot, payload, payload),
        });
      }
      intents.complete(slot);
      await invalidate();
      setOpen(false);
    } catch (cause) {
      intents.fail(slot, cause);
      setError(bollaErrorMessage(cause, t("entiEsterni.saveError")));
    }
  };
  const toggleActive = async (item: EnteDestinatario) => {
    setError("");
    const slot = `ente:${item.id}:active`;
    const payload = { versione: item.versione, attivo: !item.attivo };
    try {
      await update.mutateAsync({
        id: item.id,
        data: intents.prepare(slot, payload, payload),
      });
      intents.complete(slot);
      await invalidate();
    } catch (cause) {
      intents.fail(slot, cause);
      setError(bollaErrorMessage(cause, t("entiEsterni.saveError")));
    }
  };

  return (
    <div className="space-y-5 p-4 md:p-6" data-testid="enti-esterni-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("entiEsterni.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("entiEsterni.subtitle")}
          </p>
        </div>
        {canManage && (
          <Button onClick={beginCreate}>{t("entiEsterni.new")}</Button>
        )}
      </header>
      <div className="space-y-1">
        <Label htmlFor="enti-area-filter">{t("entiEsterni.areaFilter")}</Label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select
            value={areaFilter}
            onValueChange={(value) => {
              setAreaFilter(value);
              setOffset(0);
            }}
          >
            <SelectTrigger id="enti-area-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {user?.areaOperativaId == null && (
                <SelectItem value="all">{t("entiEsterni.allAreas")}</SelectItem>
              )}
              <SelectItem value="global">
                {t("entiEsterni.onlyGlobal")}
              </SelectItem>
              {areas
                ?.filter(
                  (area) =>
                    user?.areaOperativaId == null ||
                    area.id === user.areaOperativaId,
                )
                .map((area) => (
                  <SelectItem key={area.id} value={String(area.id)}>
                    {area.nome} · {t("entiEsterni.withGlobal")}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={areaFilter === "global" ? "default" : "outline"}
            aria-controls="enti-results"
            onClick={() => {
              setAreaFilter("global");
              setOffset(0);
            }}
          >
            {t("entiEsterni.onlyGlobal")}
          </Button>
        </div>
      </div>
      <Label htmlFor="enti-search">{t("entiEsterni.search")}</Label>
      <Input
        id="enti-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {search.trim().length === 1 && (
        <p className="text-sm text-muted-foreground">
          {t("entiEsterni.minSearch")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {list.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("entiEsterni.loadError")}
        </p>
      )}
      <div id="enti-results" className="space-y-2">
        {(searchReady ? (list.data ?? []) : []).map((item) => (
          <Card key={item.id} data-testid={`ente-${item.id}`}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  <span>{item.denominazione}</span>
                  {item.areaOperativaId == null && (
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                      {t("entiEsterni.global")}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.indirizzo} ·{" "}
                  {item.areaOperativaId == null
                    ? t("entiEsterni.global")
                    : (areaNames.get(item.areaOperativaId) ??
                      item.areaOperativaId)}
                  {item.telefono ? ` · ${item.telefono}` : ""}
                  {item.email ? ` · ${item.email}` : ""}
                </p>
                <p className="text-xs">
                  {item.attivo
                    ? t("entiEsterni.active")
                    : t("entiEsterni.inactive")}
                </p>
              </div>
              {canManage && (item.areaOperativaId != null || globalAdmin) && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => beginEdit(item)}>
                    {t("entiEsterni.edit")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void toggleActive(item)}
                    disabled={update.isPending}
                  >
                    {item.attivo
                      ? t("entiEsterni.deactivate")
                      : t("entiEsterni.reactivate")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {list.data?.length === 0 && searchReady && <p>{t("entiEsterni.none")}</p>}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {t("entiEsterni.previous")}
        </Button>
        <Button
          variant="outline"
          disabled={!searchReady || (list.data?.length ?? 0) < 50}
          onClick={() => setOffset(offset + 50)}
        >
          {t("entiEsterni.next")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t("entiEsterni.edit") : t("entiEsterni.new")}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            {globalAdmin && !editing && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="ente-global">{t("entiEsterni.global")}</Label>
                <Switch
                  id="ente-global"
                  checked={form.areaOperativaId === "global"}
                  onCheckedChange={(checked) => setField("areaOperativaId", checked ? "global" : "")}
                />
              </div>
            )}
            {form.areaOperativaId === "global" && (
              <p className="text-sm text-muted-foreground">{t("entiEsterni.globalHint")}</p>
            )}
            <Label htmlFor="ente-area">{t("entiEsterni.area")}</Label>
            {globalAdmin && !editing ? (
              <Select
                value={form.areaOperativaId}
                onValueChange={(value) => setField("areaOperativaId", value)}
              >
                <SelectTrigger id="ente-area">
                  <SelectValue placeholder={t("entiEsterni.chooseArea")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">
                    {t("entiEsterni.global")}
                  </SelectItem>
                  {areas
                    ?.filter((area) => area.attivo)
                    .map((area) => (
                      <SelectItem key={area.id} value={String(area.id)}>
                        {area.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <p id="ente-area" className="text-sm">
                {form.areaOperativaId === "global"
                  ? t("entiEsterni.global")
                  : (areaNames.get(Number(form.areaOperativaId)) ??
                    form.areaOperativaId)}
              </p>
            )}

            <Label htmlFor="ente-name">{t("entiEsterni.name")}</Label>
            <Input
              id="ente-name"
              value={form.denominazione}
              onChange={(event) =>
                setField("denominazione", event.target.value)
              }
              maxLength={200}
              required
            />
            <Label htmlFor="ente-address">{t("entiEsterni.address")}</Label>
            <Input
              id="ente-address"
              value={form.indirizzo}
              onChange={(event) => setField("indirizzo", event.target.value)}
              maxLength={250}
              required
            />
            <Label htmlFor="ente-phone">{t("entiEsterni.phone")}</Label>
            <Input
              id="ente-phone"
              value={form.telefono}
              onChange={(event) => setField("telefono", event.target.value)}
              maxLength={50}
            />
            <Label htmlFor="ente-email">{t("entiEsterni.email")}</Label>
            <Input
              id="ente-email"
              type="email"
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
              maxLength={200}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || update.isPending}
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
