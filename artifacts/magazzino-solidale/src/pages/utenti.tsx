import { useState } from "react";
import {
  useListUtenti,
  useCreateUtente,
  useUpdateUtente,
  useDeleteUtente,
  useResetUtentePassword,
  useListRuoli,
  getListUtentiQueryKey,
  type Utente,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Plus, Pencil, Trash2, KeyRound } from "lucide-react";

const NO_ROLE = "none";

export default function Utenti() {
  const { user: currentUser } = useAuth();
  const { data: utenti, isLoading } = useListUtenti();
  const { data: ruoli } = useListRuoli();
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
  const [nome, setNome] = useState("");
  const [password, setPassword] = useState("");
  const [ruoloId, setRuoloId] = useState<string>(NO_ROLE);
  const [attivo, setAttivo] = useState(true);
  const [resetPwd, setResetPwd] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListUtentiQueryKey() });

  const openCreate = () => {
    setEditing(null);
    setUsername("");
    setNome("");
    setPassword("");
    setRuoloId(NO_ROLE);
    setAttivo(true);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (u: Utente) => {
    setEditing(u);
    setUsername(u.username);
    setNome(u.nome);
    setPassword("");
    setRuoloId(u.ruoloId != null ? String(u.ruoloId) : NO_ROLE);
    setAttivo(u.attivo);
    setFormError(null);
    setIsFormOpen(true);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const ruoloIdValue = ruoloId === NO_ROLE ? null : parseInt(ruoloId, 10);

    if (editing) {
      updateUtente.mutate(
        {
          id: editing.id,
          data: { nome, ruoloId: ruoloIdValue, attivo },
        },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "Utente aggiornato" });
            setIsFormOpen(false);
          },
          onError: (err) => setFormError(extractError(err)),
        },
      );
    } else {
      if (password.length < 8) {
        setFormError("La password deve avere almeno 8 caratteri.");
        return;
      }
      createUtente.mutate(
        {
          data: {
            username: username.trim(),
            nome,
            password,
            ruoloId: ruoloIdValue,
            attivo,
          },
        },
        {
          onSuccess: () => {
            invalidate();
            toast({
              title: "Utente creato",
              description: "Dovrà cambiare la password al primo accesso.",
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
          toast({ title: "Utente eliminato" });
          setDeleting(null);
        },
        onError: (err) => {
          toast({
            title: "Impossibile eliminare",
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
        title: "Password troppo corta",
        description: "Minimo 8 caratteri.",
        variant: "destructive",
      });
      return;
    }
    resetPassword.mutate(
      { id: resetting.id, data: { newPassword: resetPwd } },
      {
        onSuccess: () => {
          toast({
            title: "Password reimpostata",
            description: "L'utente dovrà cambiarla al prossimo accesso.",
          });
          setResetting(null);
          setResetPwd("");
        },
        onError: (err) =>
          toast({
            title: "Errore",
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
          <h1 className="text-2xl font-semibold">Utenti</h1>
          <p className="text-sm text-muted-foreground">
            Gestisci gli account e i ruoli del personale
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nuovo utente
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-0" />
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
                  <TableHead>Username</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Ruolo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Ultimo accesso</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {utenti?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>{u.nome}</TableCell>
                    <TableCell>{u.ruoloNome ?? "—"}</TableCell>
                    <TableCell>
                      {u.attivo ? (
                        <Badge className="bg-emerald-500/10 text-emerald-700">
                          Attivo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Disattivato</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.ultimoAccesso
                        ? new Date(u.ultimoAccesso).toLocaleString("it-IT")
                        : "mai"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(u)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Modifica
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setResetting(u);
                              setResetPwd("");
                            }}
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Reimposta password
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={u.id === currentUser?.id}
                            onClick={() => setDeleting(u)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Elimina
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {utenti?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-8"
                    >
                      Nessun utente
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {editing ? "Modifica utente" : "Nuovo utente"}
            </SheetTitle>
          </SheetHeader>
          <form onSubmit={onSubmit} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label htmlFor="u-username">Username</Label>
              <Input
                id="u-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!!editing}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-nome">Nome completo</Label>
              <Input
                id="u-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
              />
            </div>
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="u-password">Password iniziale</Label>
                <Input
                  id="u-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  L'utente dovrà cambiarla al primo accesso.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Ruolo</Label>
              <Select value={ruoloId} onValueChange={setRuoloId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona ruolo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE}>Nessun ruolo</SelectItem>
                  {ruoli?.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="u-attivo">Account attivo</Label>
              <Switch
                id="u-attivo"
                checked={attivo}
                onCheckedChange={setAttivo}
              />
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={createUtente.isPending || updateUtente.isPending}
            >
              {editing ? "Salva modifiche" : "Crea utente"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!resetting}
        onOpenChange={(open) => !open && setResetting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reimposta password</DialogTitle>
          </DialogHeader>
          <form onSubmit={confirmReset} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Imposta una nuova password per{" "}
              <span className="font-medium">{resetting?.username}</span>. Dovrà
              cambiarla al prossimo accesso.
            </p>
            <div className="space-y-2">
              <Label htmlFor="reset-pwd">Nuova password</Label>
              <Input
                id="reset-pwd"
                type="password"
                autoComplete="new-password"
                value={resetPwd}
                onChange={(e) => setResetPwd(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetting(null)}
              >
                Annulla
              </Button>
              <Button type="submit" disabled={resetPassword.isPending}>
                Reimposta
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare l'utente?</AlertDialogTitle>
            <AlertDialogDescription>
              L'account{" "}
              <span className="font-medium">{deleting?.username}</span> verrà
              rimosso definitivamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Elimina
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
  return "Operazione non riuscita.";
}
