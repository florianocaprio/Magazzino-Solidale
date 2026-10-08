import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getListUtenteMenseQueryKey,
  useListMense,
  useListUtenteMense,
  useSetUtenteMensa,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { mensaErrorMessage } from "@/lib/mensa-ui";

/** Separato dal salvataggio dell'Utente: assegnazione esplicita già persistita. */
export function UtenteMense({
  utenteId,
  areaId,
}: {
  utenteId: number;
  areaId: number | null;
}) {
  const { t } = useTranslation();
  const query = useQueryClient();
  const list = useListUtenteMense(utenteId);
  const mense = useListMense();
  const mutation = useSetUtenteMensa();
  const [mensaId, setMensaId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const setAssignment = (id: number, attiva: boolean) =>
    mutation.mutate(
      { utenteId, mensaId: id, data: { attiva, motivo: motivo.trim() } },
      {
        onSuccess: () => {
          setError("");
          query.invalidateQueries({
            queryKey: getListUtenteMenseQueryKey(utenteId),
          });
        },
        onError: (failure) =>
          setError(mensaErrorMessage(failure, t("mensa.actionFailed"))),
      },
    );
  return (
    <section className="space-y-2 rounded border p-3">
      <h3 className="font-medium">{t("mensa.operatorAssignments")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("mensa.assignmentHint")}
      </p>
      {(list.isError || mense.isError) && (
        <p role="alert">{t("mensa.loadError")}</p>
      )}
      {list.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : (
        list.data?.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2"
          >
            <span>
              {mense.data?.find((mensa) => mensa.id === item.mensaId)?.nome ??
                `#${item.mensaId}`}{" "}
              ·{" "}
              {item.attiva ? t("common.active") : t("mensa.revokedAssignment")}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={!motivo.trim() || mutation.isPending}
              onClick={() => setAssignment(item.mensaId, !item.attiva)}
            >
              {item.attiva
                ? t("mensa.revokeAssignment")
                : t("mensa.restoreAssignment")}
            </Button>
          </div>
        ))
      )}
      <Input
        aria-label={t("mensa.assignmentReason")}
        placeholder={t("mensa.assignmentReason")}
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
        maxLength={500}
      />
      <Select value={mensaId} onValueChange={setMensaId}>
        <SelectTrigger aria-label={t("mensa.operatorAssignments")}>
          <SelectValue placeholder="Mensa" />
        </SelectTrigger>
        <SelectContent>
          {mense.data
            ?.filter(
              (mensa) =>
                mensa.areaOperativaId === areaId &&
                !list.data?.some(
                  (item) => item.mensaId === mensa.id && item.attiva,
                ),
            )
            .map((mensa) => (
              <SelectItem key={mensa.id} value={String(mensa.id)}>
                {mensa.nome}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        disabled={!mensaId || !motivo.trim() || mutation.isPending}
        onClick={() => setAssignment(Number(mensaId), true)}
      >
        {t("mensa.assignOperator")}
      </Button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
