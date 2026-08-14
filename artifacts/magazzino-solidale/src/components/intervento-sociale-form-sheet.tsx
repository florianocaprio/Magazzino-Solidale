import type {
  InterventoInput,
  InterventoOperatore,
} from "@workspace/api-client-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  BeneficiarioCombobox,
  type BeneficiarioOption,
} from "@/components/beneficiario-combobox";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { dateTimeEuropeRomeToIso, todayEuropeRome } from "@/lib/europe-rome";

export type InterventoSocialeCreateMode =
  | "da_pianificare"
  | "pianificato"
  | "gia_effettuato";

interface TipoOption {
  id: number;
  nome: string;
  attivo: boolean;
}

interface Props {
  open: boolean;
  mode: InterventoSocialeCreateMode;
  beneficiari: BeneficiarioOption[];
  tipi: TipoOption[];
  operatori: InterventoOperatore[];
  currentOperatorId?: number;
  beneficiarySearch: string;
  isPending?: boolean;
  onBeneficiarySearch: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: InterventoInput) => void;
}

function makeSchema(
  t: (key: string) => string,
  mode: InterventoSocialeCreateMode,
) {
  return z
    .object({
      beneficiarioId: z.string().regex(/^\d+$/, t("common.requiredField")),
      tipoIntervento: z.string().trim().min(1, t("common.requiredField")),
      priorita: z.enum(["bassa", "normale", "alta", "urgente"]),
      dataPianificata: z.string(),
      oraPianificata: z.string(),
      dataIntervento: z.string(),
      sede: z.string().trim().max(255),
      operatoreId: z.string().regex(/^\d+$/, t("common.requiredField")),
      descrizione: z.string().trim().max(4000),
      esito: z.string().trim().max(4000),
      note: z.string().trim().max(2000),
    })
    .superRefine((value, context) => {
      if (mode === "pianificato") {
        if (!value.dataPianificata) {
          context.addIssue({
            code: "custom",
            path: ["dataPianificata"],
            message: t("common.requiredField"),
          });
        }
        if (!value.oraPianificata) {
          context.addIssue({
            code: "custom",
            path: ["oraPianificata"],
            message: t("common.requiredField"),
          });
        }
        if (value.dataPianificata && value.oraPianificata) {
          try {
            dateTimeEuropeRomeToIso(
              value.dataPianificata,
              value.oraPianificata,
            );
          } catch (error) {
            context.addIssue({
              code: "custom",
              path: ["oraPianificata"],
              message:
                error instanceof Error
                  ? error.message
                  : t("interventi.form.invalidDateTime"),
            });
          }
        }
      }
      if (mode === "gia_effettuato" && !value.dataIntervento) {
        context.addIssue({
          code: "custom",
          path: ["dataIntervento"],
          message: t("common.requiredField"),
        });
      }
    });
}

export function InterventoSocialeFormSheet({
  open,
  mode,
  beneficiari,
  tipi,
  operatori,
  currentOperatorId,
  beneficiarySearch,
  isPending = false,
  onBeneficiarySearch,
  onOpenChange,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const schema = makeSchema(t, mode);
  type FormValues = z.infer<typeof schema>;
  const defaultTipo = tipi.find((tipo) => tipo.attivo)?.nome ?? "colloquio";
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      beneficiarioId: "",
      tipoIntervento: defaultTipo,
      priorita: "normale",
      dataPianificata: todayEuropeRome(),
      oraPianificata: "09:00",
      dataIntervento: todayEuropeRome(),
      sede: "",
      operatoreId: currentOperatorId ? String(currentOperatorId) : "",
      descrizione: "",
      esito: "",
      note: "",
    },
  });
  const { reset } = form;
  const wasOpen = useRef(false);

  useEffect(() => {
    const isOpening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!isOpening) return;
    reset({
      beneficiarioId: "",
      tipoIntervento: defaultTipo,
      priorita: "normale",
      dataPianificata: todayEuropeRome(),
      oraPianificata: "09:00",
      dataIntervento: todayEuropeRome(),
      sede: "",
      operatoreId: currentOperatorId ? String(currentOperatorId) : "",
      descrizione: "",
      esito: "",
      note: "",
    });
  }, [currentOperatorId, defaultTipo, mode, open, reset]);

  const submit = (values: FormValues) => {
    const common: InterventoInput = {
      beneficiarioId: Number(values.beneficiarioId),
      tipoIntervento: values.tipoIntervento,
      operatoreId: Number(values.operatoreId),
      ambito: "sociale",
      priorita: values.priorita,
      sede: values.sede || null,
      descrizione: values.descrizione,
      note: values.note,
    };
    if (mode === "da_pianificare") {
      onSubmit({ ...common, stato: "da_pianificare" });
      return;
    }
    if (mode === "pianificato") {
      onSubmit({
        ...common,
        stato: "pianificato",
        dataOraPianificata: dateTimeEuropeRomeToIso(
          values.dataPianificata,
          values.oraPianificata,
        ),
      });
      return;
    }
    onSubmit({
      ...common,
      stato: "concluso",
      dataIntervento: values.dataIntervento,
      esito: values.esito,
      registrazionePregressa: true,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t(`interventi.form.titles.${mode}`)}</SheetTitle>
          <SheetDescription>
            {t(`interventi.form.descriptions.${mode}`)}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="mt-6 space-y-4">
            <FormField
              control={form.control}
              name="beneficiarioId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("interventi.beneficiario")}</FormLabel>
                  <FormControl>
                    <BeneficiarioCombobox
                      items={beneficiari}
                      value={field.value}
                      onChange={field.onChange}
                      searchValue={beneficiarySearch}
                      onSearchChange={onBeneficiarySearch}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="tipoIntervento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("interventi.tipoIntervento")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {tipi
                          .filter((tipo) => tipo.attivo)
                          .map((tipo) => (
                            <SelectItem key={tipo.id} value={tipo.nome}>
                              {tipo.nome}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priorita"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("interventi.detail.priority")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(["bassa", "normale", "alta", "urgente"] as const).map(
                          (value) => (
                            <SelectItem key={value} value={value}>
                              {t(`interventi.priorita.${value}`)}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {mode === "pianificato" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="dataPianificata"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("interventi.form.date")}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="oraPianificata"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("interventi.form.time")}</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
            {mode === "gia_effettuato" && (
              <FormField
                control={form.control}
                name="dataIntervento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("interventi.form.occurredDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="sede"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("interventi.detail.site")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="operatoreId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("interventi.form.assignedOperator")}
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {operatori.map((operatore) => (
                          <SelectItem
                            key={operatore.id}
                            value={String(operatore.id)}
                          >
                            {operatore.nome} · {operatore.codice}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="descrizione"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.description")}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {mode === "gia_effettuato" && (
              <FormField
                control={form.control}
                name="esito"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("interventi.esito")}</FormLabel>
                    <FormControl>
                      <Textarea rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("interventi.note")}</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
