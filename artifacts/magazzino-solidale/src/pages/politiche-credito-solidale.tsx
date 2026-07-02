import { useState } from "react";
import {
  getListPoliticheCreditoSolidaleQueryKey,
  useCreatePoliticaCreditoSolidale,
  useDeletePoliticaCreditoSolidale,
  useListCentriAscolto,
  useListCitta,
  useListPoliticheCreditoSolidale,
  useUpdatePoliticaCreditoSolidale,
  type PoliticaCreditoSolidale,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { HeartHandshake, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";
const ROUNDING_VALUES = ["nessuno", "intero_superiore", "intero_inferiore", "intero_piu_vicino"] as const;

function makeSchema(t: (k: string) => string) {
  return z.object({
    nome: z.string().min(1, t("common.requiredField")),
    descrizione: z.string().optional().default(""),
    centroAscoltoId: z.string().default(NONE),
    cittaId: z.string().default(NONE),
    attiva: z.boolean().default(true),
    creditoBaseNucleo: z.coerce.number().min(0),
    creditoPerComponente: z.coerce.number().min(0),
    bonusMinore: z.coerce.number().min(0),
    bonusAnziano: z.coerce.number().min(0),
    bonusDisabile: z.coerce.number().min(0),
    creditoMinimoMensile: z.coerce.number().min(0),
    creditoMassimoMensile: z.string().optional().default(""),
    giornoRicaricaMensile: z.coerce.number().int().min(1, t("creditoSolidale.dayRange")).max(28, t("creditoSolidale.dayRange")),
    ricaricaAutomaticaAbilitata: z.boolean().default(false),
    arrotondamento: z.enum(ROUNDING_VALUES).default("nessuno"),
    note: z.string().optional().default(""),
  }).refine((data) => {
    if (!data.creditoMassimoMensile?.trim()) return true;
    const max = Number(data.creditoMassimoMensile.replace(",", "."));
    return Number.isFinite(max) && max >= data.creditoMinimoMensile;
  }, {
    message: t("creditoSolidale.maxMustBeGreater"),
    path: ["creditoMassimoMensile"],
  });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

const defaultValues: FormValues = {
  nome: "",
  descrizione: "",
  centroAscoltoId: NONE,
  cittaId: NONE,
  attiva: true,
  creditoBaseNucleo: 50,
  creditoPerComponente: 10,
  bonusMinore: 5,
  bonusAnziano: 5,
  bonusDisabile: 10,
  creditoMinimoMensile: 0,
  creditoMassimoMensile: "",
  giornoRicaricaMensile: 1,
  ricaricaAutomaticaAbilitata: false,
  arrotondamento: "nessuno",
  note: "",
};

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

const nullable = (v: string | undefined): string | null => {
  const trimmed = v?.trim() ?? "";
  return trimmed ? trimmed : null;
};

const optionalId = (v: string): number | null => v === NONE ? null : Number(v);
const formatQuota = (v: number | null | undefined): string =>
  v == null ? "-" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(v);

export default function PoliticheCreditoSolidale() {
  const { t } = useTranslation();
  const schema = makeSchema(t);
  const { data: politiche, isLoading } = useListPoliticheCreditoSolidale();
  const { data: citta } = useListCitta();
  const { data: centri } = useListCentriAscolto();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<PoliticaCreditoSolidale | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);

  const createPolitica = useCreatePoliticaCreditoSolidale();
  const updatePolitica = useUpdatePoliticaCreditoSolidale();
  const deletePolitica = useDeletePoliticaCreditoSolidale();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPoliticheCreditoSolidaleQueryKey() });

  const scopeLabel = (p: PoliticaCreditoSolidale) => {
    if (p.centroAscoltoNome) return `${t("creditoSolidale.centerScope")}: ${p.centroAscoltoNome}`;
    if (p.cittaNome) return `${t("creditoSolidale.cityScope")}: ${p.cittaNome}`;
    return t("creditoSolidale.globalScope");
  };

  const resetForCreate = () => {
    setEditing(null);
    form.reset(defaultValues);
    setIsFormOpen(true);
  };

  const resetForEdit = (p: PoliticaCreditoSolidale) => {
    setEditing(p);
    form.reset({
      nome: p.nome,
      descrizione: p.descrizione ?? "",
      centroAscoltoId: p.centroAscoltoId == null ? NONE : String(p.centroAscoltoId),
      cittaId: p.cittaId == null ? NONE : String(p.cittaId),
      attiva: p.attiva,
      creditoBaseNucleo: p.creditoBaseNucleo,
      creditoPerComponente: p.creditoPerComponente,
      bonusMinore: p.bonusMinore,
      bonusAnziano: p.bonusAnziano,
      bonusDisabile: p.bonusDisabile,
      creditoMinimoMensile: p.creditoMinimoMensile,
      creditoMassimoMensile: p.creditoMassimoMensile == null ? "" : String(p.creditoMassimoMensile),
      giornoRicaricaMensile: p.giornoRicaricaMensile,
      ricaricaAutomaticaAbilitata: p.ricaricaAutomaticaAbilitata,
      arrotondamento: p.arrotondamento,
      note: p.note ?? "",
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    const payload = {
      nome: data.nome.trim(),
      descrizione: nullable(data.descrizione),
      centroAscoltoId: optionalId(data.centroAscoltoId),
      cittaId: optionalId(data.cittaId),
      attiva: data.attiva,
      creditoBaseNucleo: data.creditoBaseNucleo,
      creditoPerComponente: data.creditoPerComponente,
      bonusMinore: data.bonusMinore,
      bonusAnziano: data.bonusAnziano,
      bonusDisabile: data.bonusDisabile,
      creditoMinimoMensile: data.creditoMinimoMensile,
      creditoMassimoMensile: data.creditoMassimoMensile?.trim() ? Number(data.creditoMassimoMensile.replace(",", ".")) : null,
      giornoRicaricaMensile: data.giornoRicaricaMensile,
      ricaricaAutomaticaAbilitata: data.ricaricaAutomaticaAbilitata,
      arrotondamento: data.arrotondamento,
      note: nullable(data.note),
    };

    if (editing) {
      updatePolitica.mutate({ id: editing.id, data: payload }, {
        onSuccess: () => {
          invalidate();
          toast({ title: t("creditoSolidale.toastUpdated") });
          setIsFormOpen(false);
        },
        onError: (err) => toast({
          title: t("creditoSolidale.title"),
          description: extractError(err, t("creditoSolidale.saveError")),
          variant: "destructive",
        }),
      });
      return;
    }

    createPolitica.mutate({ data: payload }, {
      onSuccess: () => {
        invalidate();
        toast({ title: t("creditoSolidale.toastCreated") });
        setIsFormOpen(false);
      },
      onError: (err) => toast({
        title: t("creditoSolidale.title"),
        description: extractError(err, t("creditoSolidale.saveError")),
        variant: "destructive",
      }),
    });
  };

  const handleDeactivate = () => {
    if (!deactivatingId) return;
    deletePolitica.mutate({ id: deactivatingId }, {
      onSuccess: () => {
        invalidate();
        toast({ title: t("creditoSolidale.toastDeactivated") });
        setDeactivatingId(null);
      },
      onError: (err) => {
        toast({
          title: t("creditoSolidale.deactivateTitle"),
          description: extractError(err, t("creditoSolidale.deactivateError")),
          variant: "destructive",
        });
        setDeactivatingId(null);
      },
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("creditoSolidale.title")}</h1>
          <p className="text-muted-foreground">{t("creditoSolidale.subtitle")}</p>
        </div>
        <Button onClick={resetForCreate} className="gap-2">
          <Plus className="h-4 w-4" /> {t("creditoSolidale.newPolicy")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("creditoSolidale.policyName")}</TableHead>
                <TableHead>{t("creditoSolidale.scope")}</TableHead>
                <TableHead>{t("creditoSolidale.formula")}</TableHead>
                <TableHead className="text-center">{t("creditoSolidale.giornoRicaricaMensile")}</TableHead>
                <TableHead className="text-center">{t("creditoSolidale.status")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-44" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-64" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : politiche?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    {t("creditoSolidale.noPolicies")}
                  </TableCell>
                </TableRow>
              ) : politiche?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <HeartHandshake className="h-4 w-4 text-muted-foreground" />
                      {p.nome}
                    </div>
                    {p.descrizione ? <p className="mt-1 text-xs text-muted-foreground">{p.descrizione}</p> : null}
                  </TableCell>
                  <TableCell>{scopeLabel(p)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t("creditoSolidale.creditoBaseNucleo")} {formatQuota(p.creditoBaseNucleo)} · {t("creditoSolidale.creditoPerComponente")} {formatQuota(p.creditoPerComponente)}
                  </TableCell>
                  <TableCell className="text-center">{p.giornoRicaricaMensile}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={p.attiva ? "bg-green-500/10 text-green-700 border-none" : "bg-muted text-muted-foreground"}>
                      {p.attiva ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">{t("creditoSolidale.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => resetForEdit(p)}>
                          <Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeactivatingId(p.id)}>
                          <Trash2 className="mr-2 h-4 w-4" /> {t("creditoSolidale.deactivate")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? t("creditoSolidale.editPolicy") : t("creditoSolidale.newPolicy")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem><FormLabel>{t("creditoSolidale.policyName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="giornoRicaricaMensile" render={({ field }) => (
                    <FormItem><FormLabel>{t("creditoSolidale.giornoRicaricaMensile")}</FormLabel><FormControl><Input type="number" min={1} max={28} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="descrizione" render={({ field }) => (
                  <FormItem><FormLabel>{t("creditoSolidale.description")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
                )} />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="cittaId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("creditoSolidale.selectCity")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value={NONE}>{t("creditoSolidale.allCities")}</SelectItem>
                          {citta?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("creditoSolidale.selectCenter")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value={NONE}>{t("creditoSolidale.allCenters")}</SelectItem>
                          {centri?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {(["creditoBaseNucleo", "creditoPerComponente", "bonusMinore", "bonusAnziano", "bonusDisabile", "creditoMinimoMensile"] as const).map((name) => (
                    <FormField key={name} control={form.control} name={name} render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t(`creditoSolidale.${name}`)}</FormLabel>
                        <FormControl><Input type="number" min={0} step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  ))}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="creditoMassimoMensile" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("creditoSolidale.creditoMassimoMensile")}</FormLabel>
                      <FormControl><Input type="number" min={0} step="0.01" placeholder={t("creditoSolidale.noMaximum")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="arrotondamento" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("creditoSolidale.arrotondamento")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {ROUNDING_VALUES.map((value) => (
                            <SelectItem key={value} value={value}>{t(`creditoSolidale.rounding.${value}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="attiva" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel className="m-0">{t("creditoSolidale.activePolicy")}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="ricaricaAutomaticaAbilitata" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel className="m-0">{t("creditoSolidale.automaticFuture")}</FormLabel>
                        <FormDescription>{t("creditoSolidale.automaticFutureHint")}</FormDescription>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>{t("creditoSolidale.note")}</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                )} />

                <div className="pt-4 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createPolitica.isPending || updatePolitica.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deactivatingId} onOpenChange={(open) => !open && setDeactivatingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("creditoSolidale.deactivateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("creditoSolidale.deactivateDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="bg-destructive text-destructive-foreground">
              {t("creditoSolidale.deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
