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
      areaOperativaId: String(item.areaOperativaId),
    });
    setError("");
    setOpen(true);
  };
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListEntiDestinatariQueryKey(),
    });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const areaOperativaId = user?.isAdmin
      ? Number(form.areaOperativaId)
      : user?.areaOperativaId;
    if (
      !form.denominazione.trim() ||
      !form.indirizzo.trim() ||
      !areaOperativaId ||
      !Number.isSafeInteger(areaOperativaId)
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
      <div className="space-y-2">
        {(searchReady ? (list.data ?? []) : []).map((item) => (
          <Card key={item.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{item.denominazione}</p>
                <p className="text-sm text-muted-foreground">
                  {item.indirizzo} ·{" "}
                  {areaNames.get(item.areaOperativaId) ?? item.areaOperativaId}
                  {item.telefono ? ` · ${item.telefono}` : ""}
                  {item.email ? ` · ${item.email}` : ""}
                </p>
                <p className="text-xs">
                  {item.attivo
                    ? t("entiEsterni.active")
                    : t("entiEsterni.inactive")}
                </p>
              </div>
              {canManage && (
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
            <Label>{t("entiEsterni.area")}</Label>
            {user?.isAdmin && !editing ? (
              <Select
                value={form.areaOperativaId}
                onValueChange={(value) => setField("areaOperativaId", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("entiEsterni.chooseArea")} />
                </SelectTrigger>
                <SelectContent>
                  {areas?.map((area) => (
                    <SelectItem key={area.id} value={String(area.id)}>
                      {area.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm">
                {areaNames.get(Number(form.areaOperativaId)) ??
                  form.areaOperativaId}
              </p>
            )}
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
