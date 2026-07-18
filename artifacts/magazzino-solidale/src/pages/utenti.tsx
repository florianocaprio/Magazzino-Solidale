import { useState } from "react";
import { useListUtenti, useCreateUtente, useUpdateUtente, useDeleteUtente, useResetUtentePassword, useListRuoli, useListCentriAscolto, useListCitta, useListZoneUds, getListUtentiQueryKey, type Utente } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Plus, Pencil, Trash2, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { ruoliNelPerimetro } from "@/lib/admin-scope";

const NO_ROLE = "none";
const NO_CENTRO = "__none__";
const NO_CITTA = "__nocitta__";
const ALL_ZONE = "__allzone__";
const SUPER_ADMIN_ROLE_NAME = "SuperAdmin";

export default function Utenti() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const lockedCentroId = currentUser?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const lockedCittaId = currentUser?.cittaId ?? null;
  const isCittaLocked = lockedCittaId != null;
  const isZonaLocked = currentUser?.zonaUdsId != null;
  const canFilterAreaGeografica = currentUser?.isAdmin ?? false;
  const [cittaFilter, setCittaFilter] = useState("all");
  const [matricolaFilter, setMatricolaFilter] = useState("");
  const [nomeFilter, setNomeFilter] = useState("");
  const effectiveCittaFilter = isCittaLocked && lockedCittaId != null ? String(lockedCittaId) : cittaFilter;
  const utentiParams = {
    ...(canFilterAreaGeografica && effectiveCittaFilter !== "all" ? { cittaId: parseInt(effectiveCittaFilter, 10) } : {}),
    ...(matricolaFilter.trim() ? { matricola: matricolaFilter.trim() } : {}),
    ...(nomeFilter.trim() ? { query: nomeFilter.trim() } : {}),
  };
  const listUtentiParams = Object.keys(utentiParams).length > 0 ? utentiParams : undefined;
  const { data: utenti, isLoading } = useListUtenti(listUtentiParams, {
    query: { queryKey: getListUtentiQueryKey(listUtentiParams) },
  });
  const { data: ruoli } = useListRuoli();
  const { data: centri } = useListCentriAscolto();
  const { data: citta } = useListCitta();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createUtente = useCreateUtente();
  const updateUtente = useUpdateUtente();
  const deleteUtente = useDeleteUtente();
  const resetPassword = useResetUtentePassword();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Utente | null>(null);
  const [deleting, setDeleting] = useState<Utente | null>(null);
  const [resetting, setResetting] = useState<Utente | null>(null);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [matricola, setMatricola] = useState("");
  const [password, setPassword] = useState("");
  const [ruoloId, setRuoloId] = useState<string>(NO_ROLE);
  const [centroId, setCentroId] = useState<string>(NO_CENTRO);
  const [cittaId, setCittaId] = useState<string>(NO_CITTA);
  const [zonaUdsId, setZonaUdsId] = useState<string>(ALL_ZONE);
  const [attivo, setAttivo] = useState(true);
  const [resetPwd, setResetPwd] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const selectedCittaNum = cittaId === NO_CITTA ? undefined : parseInt(cittaId, 10);
  const visibleRoles = ruoliNelPerimetro(ruoli ?? [], currentUser?.aree ?? [], currentUser?.isSuperAdmin ?? false);
  const editingSelf = editing?.id === currentUser?.id;
  const { data: zoneUds } = useListZoneUds(
    { cittaId: selectedCittaNum },
    {
      query: {
        enabled: selectedCittaNum != null,
        queryKey: ["zoneUds", selectedCittaNum],
      },
    },
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListUtentiQueryKey() });

  const openCreate = () => {
    setEditing(null);
    setUsername("");
    setEmail("");
    setNome("");
    setCognome("");
    setMatricola("");
    setPassword("");
    setRuoloId(NO_ROLE);
    setCentroId(isCentroLocked ? String(lockedCentroId) : NO_CENTRO);
    setCittaId(isCittaLocked ? String(lockedCittaId) : NO_CITTA);
    setZonaUdsId(ALL_ZONE);
    setAttivo(true);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (u: Utente) => {
    if (u.isSuperAdmin && !currentUser?.isSuperAdmin) return;
    setEditing(u);
    setUsername(u.username);
    setEmail(u.email ?? "");
    setNome(u.nome);
    setCognome(u.cognome ?? "");
    setMatricola(u.matricola ?? "");
    setPassword("");
    setRuoloId(u.ruoloId != null ? String(u.ruoloId) : NO_ROLE);
    setCentroId(u.centroAscoltoId != null ? String(u.centroAscoltoId) : NO_CENTRO);
    setCittaId(u.cittaId != null ? String(u.cittaId) : NO_CITTA);
    setZonaUdsId(u.zonaUdsId != null ? String(u.zonaUdsId) : ALL_ZONE);
    setAttivo(u.attivo);
    setFormError(null);
    setIsFormOpen(true);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const ruoloIdValue = ruoloId === NO_ROLE ? null : parseInt(ruoloId, 10);
    const centroIdValue = isCentroLocked ? lockedCentroId : centroId === NO_CENTRO ? null : parseInt(centroId, 10);
    const cittaIdValue = isCittaLocked ? lockedCittaId : cittaId === NO_CITTA ? null : parseInt(cittaId, 10);
    const zonaUdsIdValue = cittaIdValue == null || zonaUdsId === ALL_ZONE ? null : parseInt(zonaUdsId, 10);

    if (editing) {
      updateUtente.mutate(
        {
          id: editing.id,
          data: {
            nome,
            email: email.trim(),
            cognome: cognome.trim() || null,
            matricola: matricola.trim() || null,
            ruoloId: ruoloIdValue,
            centroAscoltoId: centroIdValue,
            cittaId: cittaIdValue,
            zonaUdsId: zonaUdsIdValue,
            attivo,
          },
        },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: t("utenti.toastUpdated") });
            setIsFormOpen(false);
          },
          onError: (err) => setFormError(extractError(err)),
        },
      );
    } else {
      if (password.length < 8) {
        setFormError(t("utenti.pwdShort"));
        return;
      }
      createUtente.mutate(
        {
          data: {
            username: username.trim(),
            email: email.trim(),
            nome,
            cognome: cognome.trim(),
            matricola: matricola.trim() || null,
            password,
            ruoloId: ruoloIdValue,
            centroAscoltoId: centroIdValue,
            cittaId: cittaIdValue,
            zonaUdsId: zonaUdsIdValue,
            attivo,
          },
        },
        {
          onSuccess: () => {
            invalidate();
            toast({
              title: t("utenti.toastCreated"),
              description: t("utenti.toastCreatedDesc"),
            });
            setIsFormOpen(false);
          },
          onError: (err) => setFormError(extractError(err)),
        },
      );
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteUtente.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: t("utenti.toastDeleted") });
          setDeleting(null);
        },
        onError: (err) => {
          toast({
            title: t("utenti.cannotDelete"),
            description: extractError(err),
            variant: "destructive",
          });
          setDeleting(null);
        },
      },
    );
  };

  const confirmReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetting) return;
    if (resetPwd.length < 8) {
      toast({
        title: t("utenti.pwdTooShort"),
        description: t("utenti.minChars"),
        variant: "destructive",
      });
      return;
    }
    resetPassword.mutate(
      { id: resetting.id, data: { newPassword: resetPwd } },
      {
        onSuccess: () => {
          toast({
            title: t("utenti.pwdReset"),
            description: t("utenti.pwdResetDesc"),
          });
          setResetting(null);
          setResetPwd("");
        },
        onError: (err) =>
          toast({
            title: t("utenti.error"),
            description: extractError(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("utenti.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("utenti.subtitle")}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {t("utenti.newUser")}
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="grid gap-3 md:grid-cols-3">
            {canFilterAreaGeografica && (
              <div className="space-y-2">
                <Label>
                  {t("utenti.areaGeografica", {
                    defaultValue: "Area geografica",
                  })}
                </Label>
                <Select value={effectiveCittaFilter} onValueChange={setCittaFilter} disabled={isCittaLocked}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("common.tutteCitta", {
                        defaultValue: "Tutte le aree",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {!isCittaLocked && (
                      <SelectItem value="all">
                        {t("common.tutteCitta", {
                          defaultValue: "Tutte le aree",
                        })}
                      </SelectItem>
                    )}
                    {citta?.map((area) => (
                      <SelectItem key={area.id} value={String(area.id)}>
                        {area.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="utenti-filter-matricola">{t("utenti.colMatricola")}</Label>
              <Input id="utenti-filter-matricola" value={matricolaFilter} onChange={(e) => setMatricolaFilter(e.target.value)} placeholder={t("utenti.matricolaPlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="utenti-filter-nome">{t("common.name")}</Label>
              <Input
                id="utenti-filter-nome"
                value={nomeFilter}
                onChange={(e) => setNomeFilter(e.target.value)}
                placeholder={t("utenti.searchNamePlaceholder", {
                  defaultValue: "Nome, cognome o username",
                })}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("utenti.colUsername")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("utenti.colMatricola")}</TableHead>
                  <TableHead>{t("utenti.colRuolo")}</TableHead>
                  <TableHead>{t("common.centro")}</TableHead>
                  <TableHead>{t("utenti.colCitta")}</TableHead>
                  <TableHead>{t("utenti.colZona")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("utenti.colUltimoAccesso")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {utenti?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email ?? "—"}</TableCell>
                    <TableCell>{[u.nome, u.cognome].filter(Boolean).join(" ")}</TableCell>
                    <TableCell>{u.matricola ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{u.ruoloNome ?? "—"}</span>
                        {u.isSuperAdmin && <Badge className="bg-amber-500/10 text-amber-700">SuperAdmin</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.centroAscoltoNome ?? t("common.centroComune")}</TableCell>
                    <TableCell className="text-muted-foreground">{u.cittaNome ?? t("utenti.cittaGlobale")}</TableCell>
                    <TableCell className="text-muted-foreground">{u.zonaUdsNome ?? t("utenti.tutteLeZone")}</TableCell>
                    <TableCell>{u.attivo ? <Badge className="bg-emerald-500/10 text-emerald-700">{t("common.active")}</Badge> : <Badge variant="secondary">{t("utenti.disattivato")}</Badge>}</TableCell>
                    <TableCell className="text-muted-foreground">{u.ultimoAccesso ? new Date(u.ultimoAccesso).toLocaleString("it-IT") : t("utenti.never")}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={u.isSuperAdmin && !currentUser?.isSuperAdmin} onClick={() => openEdit(u)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={u.isSuperAdmin && !currentUser?.isSuperAdmin}
                            onClick={() => {
                              setResetting(u);
                              setResetPwd("");
                            }}
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            {t("utenti.resetPassword")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" disabled={u.id === currentUser?.id || (u.isSuperAdmin && !currentUser?.isSuperAdmin)} onClick={() => setDeleting(u)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {utenti?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      {t("utenti.emptyUsers")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? t("utenti.editUser") : t("utenti.nuovoUtente")}</SheetTitle>
          </SheetHeader>
          <form onSubmit={onSubmit} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label htmlFor="u-username">{t("utenti.colUsername")}</Label>
              <Input id="u-username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!!editing} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-email">{t("common.email")}</Label>
              <Input id="u-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="u-nome">{t("common.name")}</Label>
                <Input id="u-nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-cognome">{t("common.surname")}</Label>
                <Input id="u-cognome" value={cognome} onChange={(e) => setCognome(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-matricola">{t("utenti.colMatricola")}</Label>
              <Input id="u-matricola" value={matricola} onChange={(e) => setMatricola(e.target.value)} placeholder={t("utenti.matricolaPlaceholder")} />
              <p className="text-xs text-muted-foreground">{t("utenti.matricolaHint")}</p>
            </div>
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="u-password">{t("utenti.passwordIniziale")}</Label>
                <Input id="u-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <p className="text-xs text-muted-foreground">{t("utenti.passwordHint")}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("utenti.colRuolo")}</Label>
              <Select value={ruoloId} onValueChange={setRuoloId} disabled={editingSelf && !currentUser?.isSuperAdmin}>
                <SelectTrigger>
                  <SelectValue placeholder={t("utenti.selezionaRuolo")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE}>{t("utenti.nessunRuolo")}</SelectItem>
                  {visibleRoles?.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingSelf && !currentUser?.isSuperAdmin && <p className="text-xs text-muted-foreground">Non sei autorizzato a modificare il ruolo assegnato al tuo profilo.</p>}
            </div>
            <div className="space-y-2">
              <Label>{t("common.centro")}</Label>
              <Select value={centroId} onValueChange={setCentroId} disabled={isCentroLocked}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CENTRO}>{t("common.centroComune")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isCentroLocked && <p className="text-xs text-muted-foreground">{t("common.centroLocked")}</p>}
            </div>
            <div className="space-y-2">
              <Label>{t("utenti.colCitta")}</Label>
              <Select
                value={cittaId}
                onValueChange={(v) => {
                  setCittaId(v);
                  setZonaUdsId(ALL_ZONE);
                }}
                disabled={isCittaLocked}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("utenti.selezionaCitta")} />
                </SelectTrigger>
                <SelectContent>
                  {!isCittaLocked && <SelectItem value={NO_CITTA}>{t("utenti.cittaGlobale")}</SelectItem>}
                  {(isCittaLocked ? citta?.filter((c) => c.id === lockedCittaId) : citta)?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("utenti.colZona")}</Label>
              <Select value={zonaUdsId} onValueChange={setZonaUdsId} disabled={cittaId === NO_CITTA || isZonaLocked}>
                <SelectTrigger>
                  <SelectValue placeholder={t("utenti.selezionaZona")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONE}>{t("utenti.tutteLeZone")}</SelectItem>
                  {zoneUds?.map((z) => (
                    <SelectItem key={z.id} value={String(z.id)}>
                      {z.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="u-attivo">{t("utenti.accountAttivo")}</Label>
              <Switch id="u-attivo" checked={attivo} onCheckedChange={setAttivo} />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <Button type="submit" className="w-full" disabled={createUtente.isPending || updateUtente.isPending}>
              {editing ? t("utenti.saveChanges") : t("utenti.createUser")}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog open={!!resetting} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("utenti.resetTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={confirmReset} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("utenti.resetDescBefore")} <span className="font-medium">{resetting?.username}</span>
              {t("utenti.resetDescAfter")}
            </p>
            <div className="space-y-2">
              <Label htmlFor="reset-pwd">{t("utenti.nuovaPassword")}</Label>
              <Input id="reset-pwd" type="password" autoComplete="new-password" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetting(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={resetPassword.isPending}>
                {t("utenti.resetButton")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("utenti.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("utenti.deleteDescBefore")} <span className="font-medium">{deleting?.username}</span> {t("utenti.deleteDescAfter")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function extractError(err: unknown): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return i18n.t("utenti.operationFailed");
}
