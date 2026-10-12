import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListFseAdministrativeSources,
  getListFseAdministrativeSourcesQueryKey,
  useGetFseReconciliationSource,
  getGetFseReconciliationSourceQueryKey,
  useListFseAdministrativeObservations,
  getListFseAdministrativeObservationsQueryKey,
  downloadFseOriginal,
  type FseM3bReconciliationInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api-error";

export function FseAdministrativeSourceForm({
  warehouseId,
  referenceDate,
  scopeKey,
  pending,
  onCalculate,
}: {
  warehouseId: number;
  referenceDate: string;
  scopeKey: string;
  pending: boolean;
  onCalculate: (data: FseM3bReconciliationInput) => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{
    id: number;
    version: number;
  } | null>(null);
  const [baseline, setBaseline] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const sourceInput = useRef<HTMLSelectElement>(null);
  const baselineInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const intention = useRef<{ hash: string; key: string } | null>(null);
  const params = { magazzinoId: warehouseId, page, pageSize: 20 };
  const query = useListFseAdministrativeSources(params, {
    query: {
      enabled: warehouseId > 0,
      queryKey: [...getListFseAdministrativeSourcesQueryKey(params), scopeKey],
    },
  });
  const rows = query.isError ? [] : (query.data?.rows ?? []);
  const current = rows.find((r) => r.id === selected?.id);
  const files = Array.isArray(current?.files)
    ? (current.files as Array<{
        referenceDate: string;
        role: string;
        sha256: string;
      }>)
    : [];
  const compatible =
    current != null &&
    current.versione === selected?.version &&
    files.length > 0 &&
    files.every((f) => f.referenceDate === referenceDate);
  const validBaseline =
    baseline === "" ||
    (Number.isSafeInteger(Number(baseline)) && Number(baseline) > 0);
  const summary = current?.summary as
    | {
        observations?: number;
        registered?: number;
        excluded?: number;
        anomalous?: number;
      }
    | undefined;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("fseOperations.sourceNotice")}
      </p>
      {query.isError ? (
        <p role="alert">
          {errorMessage(query.error, t("fseOperations.failed"))}
        </p>
      ) : query.isLoading ? (
        <p role="status">{t("fseOperations.loading")}</p>
      ) : (
        <>
          <Label htmlFor="m3b-source">
            {t("fseOperations.administrativeSource")}
          </Label>
          <select
            ref={sourceInput}
            id="m3b-source"
            aria-describedby={!compatible ? "m3b-source-error" : undefined}
            className={`w-full rounded-md border p-2 ${!compatible ? "border-destructive" : ""}`}
            aria-invalid={!compatible}
            value={selected?.id ?? ""}
            onChange={(e) => {
              const r = rows.find((item) => item.id === Number(e.target.value));
              setSelected(
                r ? { id: Number(r.id), version: Number(r.versione) } : null,
              );
              setConfirmed(false);
            }}
          >
            <option value="">{t("fseOperations.selectSource")}</option>
            {rows.map((r) => (
              <option key={Number(r.id)} value={Number(r.id)}>
                #{String(r.id)} · v{String(r.versione)} · {String(r.modalita)} ·{" "}
                {String(r.stato)}
              </option>
            ))}
          </select>
          {!compatible && (
            <p id="m3b-source-error" className="text-sm text-destructive">
              {t("fseOperations.sourceVersionRequired")}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => {
                setPage((p) => p - 1);
                setSelected(null);
                setConfirmed(false);
              }}
            >
              {t("fseOperations.previousPage")}
            </Button>
            <span>
              {page} · {query.data?.total ?? 0}
            </span>
            <Button
              variant="outline"
              disabled={page * 20 >= (query.data?.total ?? 0)}
              onClick={() => {
                setPage((p) => p + 1);
                setSelected(null);
                setConfirmed(false);
              }}
            >
              {t("fseOperations.nextPage")}
            </Button>
          </div>
        </>
      )}
      {compatible && (
        <ul className="break-all text-xs">
          {files.map((f) => (
            <li key={f.sha256}>
              {f.role} · {f.referenceDate} · SHA256 {f.sha256}
            </li>
          ))}
        </ul>
      )}
      {summary && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {(
            ["observations", "registered", "excluded", "anomalous"] as const
          ).map((key) => (
            <div key={key}>
              <dt>{t(`fseOperations.source${key}`)}</dt>
              <dd>{summary[key] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}
      <Label htmlFor="m3b-baseline">{t("fseOperations.baselineRun")}</Label>
      <Input
        ref={baselineInput}
        id="m3b-baseline"
        type="number"
        min={1}
        value={baseline}
        aria-invalid={!validBaseline}
        aria-describedby={!validBaseline ? "m3b-baseline-error" : undefined}
        className={!validBaseline ? "border-destructive" : ""}
        onChange={(e) => {
          setBaseline(e.target.value);
          setConfirmed(false);
        }}
      />
      {!validBaseline && (
        <p id="m3b-baseline-error" className="text-sm text-destructive">
          {t("fseOperations.requiredValue")}
        </p>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          ref={confirmationInput}
          type="checkbox"
          aria-invalid={!confirmed}
          aria-describedby={!confirmed ? "m3b-confirm-error" : undefined}
          className={!confirmed ? "outline outline-1 outline-destructive" : ""}
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t("fseOperations.confirmSource")} #{selected?.id ?? "—"} / v
        {selected?.version ?? "—"} / {referenceDate} /{" "}
        {t("fseOperations.baselineRun")}: {baseline || "—"}
      </label>
      {!confirmed && (
        <p id="m3b-confirm-error" className="text-sm text-destructive">
          {t("fseOperations.requiredValue")}
        </p>
      )}
      <Button
        disabled={pending || query.isLoading || query.isError}
        onClick={() => {
          if (!selected || !compatible) {
            sourceInput.current?.focus();
            return;
          }
          if (!validBaseline) {
            baselineInput.current?.focus();
            return;
          }
          if (!confirmed) {
            confirmationInput.current?.focus();
            return;
          }
          const input = {
            sourceType: "FSE_M3B" as const,
            magazzinoId: warehouseId,
            sessionId: selected.id,
            sessionVersion: selected.version,
            dataRiferimento: referenceDate,
            baselineRunId: baseline ? Number(baseline) : null,
          };
          const hash = JSON.stringify(input);
          if (intention.current?.hash !== hash)
            intention.current = { hash, key: crypto.randomUUID() };
          onCalculate({ ...input, commandKey: intention.current.key });
        }}
      >
        {t("fseOperations.calculate")}
      </Button>
    </div>
  );
}

export function FseAdministrativeProvenance({
  id,
  scopeKey,
}: {
  id: number;
  scopeKey: string;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const source = useGetFseReconciliationSource(id, {
    query: {
      queryKey: [...getGetFseReconciliationSourceQueryKey(id), scopeKey],
    },
  });
  const params = { page, pageSize: 20 };
  const observations = useListFseAdministrativeObservations(id, params, {
    query: {
      queryKey: [
        ...getListFseAdministrativeObservationsQueryKey(id, params),
        scopeKey,
      ],
    },
  });
  if (source.isError || observations.isError)
    return <p role="alert">{t("fseOperations.failed")}</p>;
  return (
    <details>
      <summary>{t("fseOperations.sourceProvenance")}</summary>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
        {JSON.stringify(source.data, null, 2)}
      </pre>
      <p>
        {t("fseOperations.externalObservations")}:{" "}
        {observations.data?.total ?? "—"}
      </p>
      {(observations.data?.rows ?? []).map((r) => (
        <div key={Number(r.id)} className="my-2 rounded border p-2 text-xs">
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(
              {
                id: r.id,
                rowId: r.rowId,
                stockRowId: r.stockRowId,
                revisionId: r.revisionId,
                original: r.originalJson,
                interpreted: r.interpretedJson,
                quality: r.qualityJson,
                registeredPortions: r.lineage,
              },
              null,
              2,
            )}
          </pre>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={page === 1}
        onClick={() => setPage((p) => p - 1)}
      >
        {t("fseOperations.previousPage")}
      </Button>
      <Button
        variant="outline"
        disabled={page * 20 >= (observations.data?.total ?? 0)}
        onClick={() => setPage((p) => p + 1)}
      >
        {t("fseOperations.nextPage")}
      </Button>
    </details>
  );
}

export function FseOriginalDownload({ id }: { id: number }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const reasonInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    epoch.current++;
    setReason("");
    setError(null);
    setBusy(false);
    return () => {
      epoch.current++;
      abort.current?.abort();
    };
  }, [id]);
  return (
    <div className="space-y-2 rounded border p-3">
      <p className="text-sm">{t("fseOperations.originalNotice")}</p>
      <Label htmlFor="fse-original-reason">
        {t("fseOperations.motivation")}
      </Label>
      <Input
        ref={reasonInput}
        id="fse-original-reason"
        value={reason}
        maxLength={1000}
        aria-invalid={!reason.trim()}
        aria-describedby={!reason.trim() ? "fse-original-required" : undefined}
        className={!reason.trim() ? "border-destructive" : ""}
        onChange={(e) => setReason(e.target.value)}
      />
      {!reason.trim() && (
        <p id="fse-original-required" className="text-sm text-destructive">
          {t("fseOperations.requiredValue")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          if (!reason.trim()) {
            reasonInput.current?.focus();
            return;
          }
          setBusy(true);
          setError(null);
          abort.current = new AbortController();
          const requestEpoch = epoch.current;
          try {
            const blob = await downloadFseOriginal(
              id,
              { motivo: reason.trim() },
              { signal: abort.current.signal, cache: "no-store" },
            );
            if (epoch.current !== requestEpoch) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `fse-${id}-storico-rigenerato.xlsx`;
            link.click();
            URL.revokeObjectURL(url);
          } catch (e) {
            if (epoch.current === requestEpoch)
              setError(errorMessage(e, t("fseOperations.failed")));
          } finally {
            if (epoch.current === requestEpoch) setBusy(false);
          }
        }}
      >
        {t("fseOperations.originalDownload")}
      </Button>
    </div>
  );
}
