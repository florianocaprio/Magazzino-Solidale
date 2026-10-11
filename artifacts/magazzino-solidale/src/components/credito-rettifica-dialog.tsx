import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  createCreditoSolidaleRettifica,
  getCreditoSolidaleRettificaEsito,
  type CreditoSolidaleMovimento,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "./ui/form";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { useAuth } from "@/lib/auth";

export function CreditoRettificaDialog({
  beneficiarioId,
  saldo,
  onClose,
  onSuccess,
}: {
  beneficiarioId: number;
  saldo: number;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const recoveryStorageKey = `credito-rettifica:${user?.id}:${beneficiarioId}`;
  const pendingKey = sessionStorage.getItem(recoveryStorageKey);
  const queryClient = useQueryClient();
  const required = t("creditoSolidale.campoObbligatorio");
  const schema = z.object({
    operazione: z
      .string()
      .refine((v): boolean => v === "aggiungi" || v === "riduci", required),
    quantita: z
      .string()
      .trim()
      .min(1, required)
      .refine(
        (v) => /^[1-9]\d*$/.test(v) && Number(v) <= 99_999_999,
        t("creditoSolidale.quantitaInteraPositiva"),
      ),
    motivo: z.string().trim().min(1, required).max(1000),
    note: z.string().max(1000),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { operazione: "", quantita: "", motivo: "", note: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(!!pendingKey);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const intent = useRef<{ payload: string; key: string } | null>(
    pendingKey ? { payload: "", key: pendingKey } : null,
  );
  const values = form.watch();
  const validAmount =
    /^[1-9]\d*$/.test(values.quantita) && Number(values.quantita) <= 99_999_999;
  const delta =
    validAmount && values.operazione
      ? Number(values.quantita) * (values.operazione === "riduci" ? -1 : 1)
      : null;
  const success = async (result: CreditoSolidaleMovimento) => {
    sessionStorage.removeItem(recoveryStorageKey);
    setMessage(
      t("creditoSolidale.saldoConfermato", { saldo: result.saldoDopo }),
    );
    await queryClient.invalidateQueries({
      predicate: (q) =>
        /credito-solidale|beneficiari|cassa-emporio/.test(
          String(q.queryKey[0] ?? ""),
        ),
    });
    onSuccess?.();
    onClose();
  };
  const submit = async (v: Values) => {
    if (inFlight.current || uncertain) return;
    const data = {
      variazioneCredito:
        Number(v.quantita) * (v.operazione === "riduci" ? -1 : 1),
      motivo: v.motivo,
      note: v.note.trim() || null,
    };
    const payload = JSON.stringify(data);
    if (intent.current?.payload !== payload)
      intent.current = { payload, key: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      // Persist only the opaque key, never free-text notes or beneficiary data.
      // A reload must recover the first outcome before allowing another command.
      sessionStorage.setItem(recoveryStorageKey, intent.current.key);
      await success(
        await createCreditoSolidaleRettifica(beneficiarioId, {
          ...data,
          idempotencyKey: intent.current.key,
        }),
      );
    } catch (e) {
      const error = e as {
        status?: number;
        data?: { error?: string; fieldErrors?: Record<string, string> };
      };
      setMessage(error.data?.error ?? t("creditoSolidale.esitoIncerto"));
      if (!error.status || error.status >= 500 || error.status < 400)
        setUncertain(true);
      else sessionStorage.removeItem(recoveryStorageKey);
      if (error.status === 400) {
        for (const [field, text] of Object.entries(
          error.data?.fieldErrors ?? {},
        )) {
          const name = field === "variazioneCredito" ? "quantita" : field;
          if (name === "quantita" || name === "motivo" || name === "note")
            form.setError(
              name,
              { type: "server", message: text },
              { shouldFocus: true },
            );
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const recover = async () => {
    if (!intent.current || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await success(
        await getCreditoSolidaleRettificaEsito(
          beneficiarioId,
          intent.current.key,
        ),
      );
    } catch (e) {
      const error = e as { status?: number; data?: { error?: string } };
      if (error.status === 404) {
        sessionStorage.removeItem(recoveryStorageKey);
        setUncertain(false);
        setMessage(t("creditoSolidale.esitoAssente"));
      } else setMessage(error.data?.error ?? t("creditoSolidale.esitoIncerto"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !uncertain) onClose();
      }}
    >
      <DialogContent
        onInteractOutside={(e) => {
          if (busy || uncertain) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("creditoSolidale.rettificaCredito")}</DialogTitle>
          <DialogDescription>
            {t("creditoSolidale.rettificaDescrizione")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(submit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="operazione"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("creditoSolidale.operazione")} *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={busy || uncertain}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t("creditoSolidale.scegliOperazione")}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="aggiungi">
                        {t("creditoSolidale.aggiungiCredito")}
                      </SelectItem>
                      <SelectItem value="riduci">
                        {t("creditoSolidale.riduciCredito")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quantita"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("creditoSolidale.quantitaCrediti")} *
                  </FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      {...field}
                      disabled={busy || uncertain}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="motivo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("creditoSolidale.motivo")} *</FormLabel>
                  <FormControl>
                    <Textarea {...field} disabled={busy || uncertain} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("creditoSolidale.noteOperative")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} disabled={busy || uncertain} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div aria-live="polite" className="rounded-md border p-3 text-sm">
              <p>
                {t("creditoSolidale.saldoAttuale")}: {saldo}
              </p>
              <p>
                {t("creditoSolidale.variazioneCredito")}:{" "}
                {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
              </p>
              <p>
                {t("creditoSolidale.saldoPrevisto")}:{" "}
                {delta == null ? "—" : saldo + delta}
              </p>
            </div>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy || uncertain}
                onClick={onClose}
              >
                {t("creditoSolidale.annulla")}
              </Button>
              {uncertain ? (
                <Button type="button" onClick={recover} disabled={busy}>
                  {t("creditoSolidale.recuperaEsito")}
                </Button>
              ) : (
                <Button type="submit" disabled={busy}>
                  {t("creditoSolidale.salvaRettifica")}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
