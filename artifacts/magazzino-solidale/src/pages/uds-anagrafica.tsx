import { useMemo, useState } from "react";
import {
  useListBeneficiari,
  useCreateBeneficiario,
  useListCitta,
  useListZoneUds,
  getListBeneficiariQueryKey,
  getListCittaQueryKey,
  type Beneficiario,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, Footprints } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";

const ALL_ZONE = "__all__";
const NO_ZONE = "__none__";

function makeSchema(t: (k: string) => string, isGlobal: boolean) {
  return z.object({
    nome: z.string().min(1, t("common.requiredField")),
    cognome: z.string().min(1, t("common.requiredField")),
    soprannome: z.string().optional(),
    dataNascita: z.string().optional(),
    sesso: z.string().optional(),
    telefono: z.string().optional(),
    zonaUdsId: z.string().optional(),
    cittaId: isGlobal
      ? z.string().min(1, t("common.requiredField"))
      : z.string().optional(),
  });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

export default function UdsAnagrafica() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isGlobal = user?.cittaId == null;
  const schema = useMemo(() => makeSchema(t, isGlobal), [t, isGlobal]);

  // città filter (global super-admin only); a scoped operator is locked to theirs.
  const [filterCitta, setFilterCitta] = useState<string>("");
  // zona filter: default to operator's own zone; ALL_ZONE shows the whole città.
  const [filterZona, setFilterZona] = useState<string>(
    user?.zonaUdsId != null ? String(user.zonaUdsId) : ALL_ZONE,
  );
  const [isFormOpen, setIsFormOpen] = useState(false);

  const { data: cittaList } = useListCitta({ query: { queryKey: getListCittaQueryKey(), enabled: isGlobal } });

  const effectiveCitta = isGlobal
    ? filterCitta
      ? parseInt(filterCitta)
      : undefined
    : (user?.cittaId ?? undefined);

  const { data: zoneList } = useListZoneUds(
    effectiveCitta ? { cittaId: effectiveCitta } : undefined,
    { query: { queryKey: ["zoneUds", effectiveCitta], enabled: effectiveCitta != null } },
  );

  const listParams = {
    ...(isGlobal && effectiveCitta ? { cittaId: effectiveCitta } : {}),
    ...(filterZona !== ALL_ZONE ? { zonaUdsId: parseInt(filterZona) } : {}),
  };
  const { data: beneficiari, isLoading } = useListBeneficiari(listParams);

  const createBenef = useCreateBeneficiario();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: "",
      cognome: "",
      soprannome: "",
      dataNascita: "",
      sesso: "",
      telefono: "",
      zonaUdsId: user?.zonaUdsId != null ? String(user.zonaUdsId) : NO_ZONE,
      cittaId: "",
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });

  const handleCreate = () => {
    form.reset({
      nome: "",
      cognome: "",
      soprannome: "",
      dataNascita: "",
      sesso: "",
      telefono: "",
      zonaUdsId:
        filterZona !== ALL_ZONE
          ? filterZona
          : user?.zonaUdsId != null
            ? String(user.zonaUdsId)
            : NO_ZONE,
      cittaId: isGlobal && filterCitta ? filterCitta : "",
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    const payload: Record<string, unknown> = {
      nome: data.nome,
      cognome: data.cognome,
      centroAscoltoId: null,
    };
    if (data.soprannome) payload.soprannome = data.soprannome;
    if (data.dataNascita) payload.dataNascita = data.dataNascita;
    if (data.sesso) payload.sesso = data.sesso;
    if (data.telefono) payload.telefono = data.telefono;
    if (data.zonaUdsId && data.zonaUdsId !== NO_ZONE) {
      payload.zonaUdsId = parseInt(data.zonaUdsId);
    }
    if (isGlobal && data.cittaId) payload.cittaId = parseInt(data.cittaId);

    createBenef.mutate(
      { data: payload as never },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: t("udsAnagrafica.toastCreated") });
          setIsFormOpen(false);
        },
        onError: (err) => {
          toast({
            title: t("udsAnagrafica.newTitle"),
            description: extractError(err, t("common.requiredField")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const canale = (b: Beneficiario) => {
    const uds = b.zonaUdsId != null;
    const centro = b.centroAscoltoId != null;
    if (uds && centro)
      return { label: t("udsAnagrafica.canaleEntrambi"), cls: "bg-purple-500/10 text-purple-700" };
    if (centro)
      return { label: t("udsAnagrafica.canaleCentro"), cls: "bg-blue-500/10 text-blue-700" };
    if (uds)
      return { label: t("udsAnagrafica.canaleUds"), cls: "bg-amber-500/10 text-amber-700" };
    return { label: t("udsAnagrafica.canaleNd"), cls: "bg-muted text-muted-foreground" };
  };

  const formCitta = isGlobal && form.watch("cittaId") ? parseInt(form.watch("cittaId")!) : effectiveCitta;
  const { data: formZone } = useListZoneUds(
    formCitta ? { cittaId: formCitta } : undefined,
    { query: { queryKey: ["zoneUds", "form", formCitta], enabled: formCitta != null } },
  );

  const rows = beneficiari ?? [];

  const exportColumns = useMemo(
    () => [
      { header: t("common.surname"), accessor: (b: Beneficiario) => b.cognome },
      { header: t("common.name"), accessor: (b: Beneficiario) => b.nome },
      { header: t("udsAnagrafica.colSoprannome"), accessor: (b: Beneficiario) => b.soprannome ?? "" },
      { header: t("udsAnagrafica.colTelefono"), accessor: (b: Beneficiario) => b.telefono ?? "" },
      { header: t("udsAnagrafica.colZona"), accessor: (b: Beneficiario) => b.zonaUdsNome ?? "" },
      { header: t("udsAnagrafica.colCanale"), accessor: (b: Beneficiario) => canale(b).label },
    ],
    [t],
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("udsAnagrafica.title")}</h1>
          <p className="text-muted-foreground">{t("udsAnagrafica.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={rows}
            columns={exportColumns}
            filename="uds-anagrafica"
            title={t("udsAnagrafica.exportTitle")}
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> {t("udsAnagrafica.newPerson")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          {isGlobal && (
            <div className="space-y-1">
              <span className="text-sm font-medium">{t("udsAnagrafica.filterCitta")}</span>
              <Select value={filterCitta || ALL_ZONE} onValueChange={(v) => { setFilterCitta(v === ALL_ZONE ? "" : v); setFilterZona(ALL_ZONE); }}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder={t("udsAnagrafica.allCitta")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allCitta")}</SelectItem>
                  {cittaList?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-sm font-medium">{t("udsAnagrafica.filterZona")}</span>
            <Select value={filterZona} onValueChange={setFilterZona}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t("udsAnagrafica.allZone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allZone")}</SelectItem>
                {zoneList?.map((z) => (
                  <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.surname")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("udsAnagrafica.colSoprannome")}</TableHead>
                <TableHead>{t("udsAnagrafica.colTelefono")}</TableHead>
                <TableHead>{t("udsAnagrafica.colZona")}</TableHead>
                <TableHead className="text-center">{t("udsAnagrafica.colCanale")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(4).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {Array(6).fill(0).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    {t("udsAnagrafica.noPersone")}
                  </TableCell>
                </TableRow>
              ) : rows.map((b) => {
                const c = canale(b);
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <Footprints className="h-4 w-4 text-muted-foreground" /> {b.cognome}
                      </div>
                    </TableCell>
                    <TableCell>{b.nome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.soprannome || "-"}</TableCell>
                    <TableCell className="text-sm">{b.telefono || "-"}</TableCell>
                    <TableCell className="text-sm">{b.zonaUdsNome || "-"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`border-none ${c.cls}`}>{c.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("udsAnagrafica.newTitle")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem><FormLabel>{t("udsAnagrafica.fNome")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="cognome" render={({ field }) => (
                    <FormItem><FormLabel>{t("udsAnagrafica.fCognome")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="soprannome" render={({ field }) => (
                  <FormItem><FormLabel>{t("udsAnagrafica.fSoprannome")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataNascita" render={({ field }) => (
                    <FormItem><FormLabel>{t("udsAnagrafica.fDataNascita")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="sesso" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("udsAnagrafica.fSesso")}</FormLabel>
                      <Select value={field.value || ""} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder={t("udsAnagrafica.sessoNd")} /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="M">{t("udsAnagrafica.sessoM")}</SelectItem>
                          <SelectItem value="F">{t("udsAnagrafica.sessoF")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="telefono" render={({ field }) => (
                  <FormItem><FormLabel>{t("udsAnagrafica.fTelefono")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                {isGlobal && (
                  <FormField control={form.control} name="cittaId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("udsAnagrafica.fCitta")}</FormLabel>
                      <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); form.setValue("zonaUdsId", NO_ZONE); }}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder={t("udsAnagrafica.fCitta")} /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {cittaList?.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                )}
                <FormField control={form.control} name="zonaUdsId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("udsAnagrafica.fZona")}</FormLabel>
                    <Select value={field.value || NO_ZONE} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder={t("udsAnagrafica.allZone")} /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_ZONE}>{t("udsAnagrafica.allZone")}</SelectItem>
                        {formZone?.map((z) => (
                          <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createBenef.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
