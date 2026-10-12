import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useListMense,
  getListMenseQueryKey,
  type Mensa,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import {
  useUnsavedChangesGuard,
  UnsavedChangesDialog,
} from "@/hooks/use-unsaved-changes-guard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mensaErrorMessage } from "@/lib/mensa-ui";

type Context = {
  areaId: number;
  mense: Mensa[];
  setDirty: (dirty: boolean) => void;
  change: (action: () => void) => void;
};
const MensaContext = createContext<Context | null>(null);
export const useMensaContext = () => useContext(MensaContext);

export function MensaOperationalContext({
  children,
  heading,
}: {
  children: ReactNode;
  heading?: ReactNode;
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const actorContext = JSON.stringify([
    user?.id,
    user?.areaOperativaId,
    user?.centroAscoltoId,
    user?.aree,
    user?.permessi,
  ]);
  const [selectedArea, setArea] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedChangesGuard(dirty);
  const query = useListMense(
    {},
    {
      query: {
        queryKey: [...getListMenseQueryKey({}), "actor", actorContext],
        staleTime: 0,
        refetchOnWindowFocus: "always",
        retry: false,
      },
    },
  );
  const areas = useMemo(
    () => [
      ...new Map(
        (query.data ?? []).map((m) => [
          m.areaOperativaId,
          m.areaOperativaNome ?? String(m.areaOperativaId),
        ]),
      ).entries(),
    ],
    [query.data],
  );
  const areaId =
    user?.areaOperativaId ??
    (selectedArea != null && areas.some(([id]) => id === selectedArea)
      ? selectedArea
      : areas.length === 1
        ? areas[0][0]
        : null);
  const mense = (query.data ?? []).filter((m) => m.areaOperativaId === areaId);
  const identity = `${actorContext}:${areaId}:${mense.map((m) => m.id).join(",")}`;
  useEffect(() => setDirty(false), [identity]);
  const missingAssignment = !user?.isAdmin && user?.areaOperativaId == null;
  return (
    <div>
      {heading && <div className="px-6 pt-6">{heading}</div>}
      <div className="mx-6 mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-64 space-y-2">
          <Label htmlFor="mensa-area">{t("mensa.operationalArea")}</Label>
          <Select
            value={areaId?.toString() ?? ""}
            disabled={
              user?.areaOperativaId != null ||
              missingAssignment ||
              query.isError
            }
            onValueChange={(value) =>
              guard.requestClose(() => setArea(Number(value)))
            }
          >
            <SelectTrigger id="mensa-area">
              <SelectValue placeholder={t("mensa.selectArea")} />
            </SelectTrigger>
            <SelectContent>
              {areas.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("mensa.refreshContext")}
        </Button>
      </div>
      {query.isError ? (
        <p role="alert" className="p-6 text-destructive">
          {mensaErrorMessage(query.error, t("mensa.loadError"))}
        </p>
      ) : missingAssignment || (!query.isLoading && !query.data?.length) ? (
        <p role="alert" className="p-6">
          {t("mensa.noAssignment")}
        </p>
      ) : query.isLoading ? (
        <p role="status" className="p-6">
          {t("common.loading")}
        </p>
      ) : areaId == null ? (
        <p className="p-6">{t("mensa.selectArea")}</p>
      ) : (
        <MensaContext.Provider
          key={identity}
          value={{ areaId, mense, setDirty, change: guard.requestClose }}
        >
          {children}
        </MensaContext.Provider>
      )}
      <UnsavedChangesDialog guard={guard} />
    </div>
  );
}

export function MensaSelect({
  value,
  onChange,
  historical = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  historical?: boolean;
}) {
  const { t } = useTranslation();
  const context = useMensaContext();
  const params = historical ? {} : { attiva: true };
  const query = useListMense(params, {
    query: { queryKey: getListMenseQueryKey(params), enabled: context == null },
  });
  const mense = (context?.mense ?? query.data ?? []).filter(
    (m) => historical || m.attiva,
  );
  const valid = mense.some((m) => m.id === value);
  useEffect(() => {
    if (!valid && (context != null || query.isSuccess))
      onChange(mense.length === 1 ? mense[0].id : null);
  }, [
    valid,
    mense.length,
    mense[0]?.id,
    onChange,
    context != null,
    query.isSuccess,
  ]);
  return (
    <Select
      value={valid ? String(value) : ""}
      onValueChange={(next) =>
        context
          ? context.change(() => onChange(Number(next)))
          : onChange(Number(next))
      }
    >
      <SelectTrigger aria-label="Mensa">
        <SelectValue
          placeholder={
            query.isError && !context
              ? t("mensa.loadError")
              : t("mensa.selectMensa")
          }
        />
      </SelectTrigger>
      <SelectContent>
        {mense.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.nome}
            {!m.attiva ? ` — ${t("mensa.inactive")}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
