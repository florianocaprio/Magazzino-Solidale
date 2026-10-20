import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  attivaEmporioCredito,
  getEmporioCreditoAttivazioneEsito,
  getGetEmporioCreditoAnteprimaQueryKey,
  useGetEmporioCreditoAnteprima,
  type EmporioCreditoAttivazioneResult,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  useEmporioSecurity,
  emporioReadableData,
} from "@/hooks/use-emporio-security";
import { CreditoPolicySelect } from "./credito-policy-select";
import { CreditoQuotaFields } from "./credito-quota-fields";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";

export function EmporioCreditoActivationDialog({
  beneficiarioId,
  motivo,
  onClose,
  onComplete,
}: {
  beneficiarioId: number;
  motivo: string;
  onClose: () => void;
  onComplete: (result: EmporioCreditoAttivazioneResult) => void;
}) {
  const { t } = useTranslation();
  const { user, hasArea, hasPermission } = useAuth();
  const [denied, setDenied] = useState(false);
  const canAct =
    !denied &&
    hasPermission("emporio.eligibility.manage") &&
    hasPermission("credito.quota.manage") &&
    (user?.isAdmin || hasArea("sociale"));
  const security = useEmporioSecurity();
  const client = useQueryClient();
  const key = `emporio-attivazione:${user?.id}:${beneficiarioId}`;
  const [policyChoice, setPolicyChoice] = useState<number | null | undefined>(
    undefined,
  );
  const params =
    policyChoice === undefined
      ? undefined
      : {
          politicaCreditoSolidaleId:
            policyChoice === null ? "auto" : String(policyChoice),
        };
  const query = useGetEmporioCreditoAnteprima(beneficiarioId, params, {
    query: {
      ...security.readOptions(
        getGetEmporioCreditoAnteprimaQueryKey(beneficiarioId, params),
      ),
      enabled: canAct,
    },
  });
  const preview = emporioReadableData(query);
  const [assigned, setAssigned] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(
    Boolean(sessionStorage.getItem(key)),
  );
  const intent = useRef<{ key: string; payload: string } | null>(
    sessionStorage.getItem(key)
      ? { key: sessionStorage.getItem(key)!, payload: "" }
      : null,
  );
  useEffect(() => {
    const pending = sessionStorage.getItem(key);
    intent.current = pending ? { key: pending, payload: "" } : null;
    setUncertain(Boolean(pending));
    setDenied(false);
    setMessage("");
  }, [key]);
  const inFlight = useRef(false);
  const context = JSON.stringify([user, beneficiarioId, canAct]);
  const latest = useRef(context);
  latest.current = context;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (preview) {
      setAssigned(String(preview.quotaMensileAssegnata));
      setReason(preview.motivoModificaQuota ?? "");
    }
  }, [preview?.calcoloToken]);
  const completed = async (
    result: EmporioCreditoAttivazioneResult,
    captured: string,
  ) => {
    if (!mounted.current || latest.current !== captured) return;
    sessionStorage.removeItem(key);
    setUncertain(false);
    await client.invalidateQueries({
      predicate: (q) =>
        /\/api\/(emporio|accessi-emporio|cassa-emporio|credito-solidale|beneficiari)(?:\/|$)/.test(
          String(q.queryKey[0]),
        ),
    });
    if (mounted.current && latest.current === captured) onComplete(result);
  };
  const submit = async () => {
    setSubmitted(true);
    if (
      inFlight.current ||
      uncertain ||
      !preview ||
      !canAct ||
      query.isFetching ||
      !/^\d+$/.test(assigned) ||
      Number(assigned) > 99999999 ||
      (Number(assigned) !== preview.totaleSuggerito && !reason.trim())
    )
      return;
    const data = {
      versioneBeneficiario: preview.versioneBeneficiario,
      calcoloToken: preview.calcoloToken,
      motivo: motivo.trim(),
      politicaCreditoSolidaleId: preview.politicaCreditoSolidaleId,
      quotaMensileAssegnata: Number(assigned),
      motivoModificaQuota: reason.trim() || null,
    };
    const payload = JSON.stringify(data);
    if (intent.current?.payload !== payload)
      intent.current = { key: crypto.randomUUID(), payload };
    const captured = latest.current;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      // Solo la chiave opaca viene conservata, mai note o dati della persona.
      sessionStorage.setItem(key, intent.current.key);
      await completed(
        await attivaEmporioCredito(beneficiarioId, {
          ...data,
          idempotencyKey: intent.current.key,
        }),
        captured,
      );
    } catch (e) {
      if (latest.current !== captured || !mounted.current) return;
      const err = e as { status?: number; data?: { error?: string } };
      setMessage(err.data?.error ?? t("ciclo2Credito.uncertain"));
      if ([401, 403, 404].includes(err.status ?? 0)) setDenied(true);
      if (!err.status || err.status >= 500 || err.status < 400)
        setUncertain(true);
      else {
        sessionStorage.removeItem(key);
        if (err.status === 409) void query.refetch();
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const recover = async () => {
    if (inFlight.current || !intent.current || !canAct) return;
    inFlight.current = true;
    setBusy(true);
    const captured = latest.current;
    try {
      await completed(
        await getEmporioCreditoAttivazioneEsito(beneficiarioId, {
          idempotencyKey: intent.current.key,
        }),
        captured,
      );
    } catch (e) {
      if (mounted.current && latest.current === captured) {
        const err = e as { status?: number; data?: { error?: string } };
        if (err.status === 404) {
          sessionStorage.removeItem(key);
          setUncertain(false);
          setMessage(t("ciclo2Credito.absent"));
          void query.refetch();
        } else {
          if ([401, 403].includes(err.status ?? 0)) setDenied(true);
          setMessage(err.data?.error ?? t("ciclo2Credito.uncertain"));
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("ciclo2Credito.title")}</DialogTitle>
          <DialogDescription>
            {t("ciclo2Credito.explanation")}
          </DialogDescription>
        </DialogHeader>
        {query.isLoading && <p role="status">{t("common.loading")}</p>}
        {(!canAct || query.isError) && (
          <p role="alert">{t("ciclo2Credito.unavailable")}</p>
        )}
        {canAct && preview && !query.isError && (
          <>
            <p className="text-sm">{preview.areaNome}</p>
            <p className="text-sm">{motivo}</p>
            <CreditoPolicySelect
              value={String(
                policyChoice === undefined
                  ? (preview.politicaCreditoSolidaleId ?? "auto")
                  : (policyChoice ?? "auto"),
              )}
              onValueChange={(v) => {
                setPolicyChoice(v === "auto" ? null : Number(v));
                setSubmitted(false);
              }}
              disabled={busy || uncertain || query.isFetching}
              automaticLabel={t("ciclo2Credito.automaticPolicy")}
              options={preview.politicheDisponibili.map((p) => ({
                id: p.id,
                nome: p.nome,
                scope: t(`ciclo2Credito.scope.${p.ambito}`),
              }))}
            />
            <p className="rounded-md border bg-muted/30 p-3 text-sm">
              <strong>{t("creditoSolidale.politicaApplicata")}:</strong>{" "}
              {preview.politicaNome}
            </p>
            <CreditoQuotaFields
              suggested={preview.totaleSuggerito}
              value={assigned}
              reason={reason}
              onValueChange={setAssigned}
              onReasonChange={setReason}
              submitted={submitted}
              disabled={busy || uncertain}
            />
            <p className="rounded-md border bg-muted/30 p-3 text-sm">
              {t(
                preview.primaQuotaAmmessa
                  ? "ciclo2Credito.firstAmount"
                  : "ciclo2Credito.noFirst",
                { amount: assigned },
              )}
            </p>
          </>
        )}
        {message && (
          <p role="alert" className="text-destructive">
            {message}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          {uncertain ? (
            <Button
              type="button"
              onClick={() => void recover()}
              disabled={busy || !canAct}
            >
              {t("ciclo2Credito.recover")}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={
                busy || !canAct || query.isFetching || query.isError || !preview
              }
            >
              {t("ciclo2Credito.confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
