import { useState } from "react";
import {
  useListRuoli,
  useCreateRuolo,
  useUpdateRuolo,
  useDeleteRuolo,
  getListRuoliQueryKey,
  type Ruolo,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ALL_AREAS } from "@/lib/areas";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { AREA_LABEL } from "@/lib/areas";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { useAuth } from "@/lib/auth";

const SUPER_ADMIN_ROLE_NAME = "SuperAdmin";

export default function Ruoli() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: ruoli, isLoading } = useListRuoli();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createRuolo = useCreateRuolo();
  const updateRuolo = useUpdateRuolo();
  const deleteRuolo = useDeleteRuolo();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Ruolo | null>(null);
  const [deleting, setDeleting] = useState<Ruolo | null>(null);

  const [nome, setNome] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [aree, setAree] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListRuoliQueryKey() });

  const openCreate = () => {
    setEditing(null);
    setNome("");
    setDescrizione("");
    setAree([]);
    setIsAdmin(false);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (r: Ruolo) => {
    if (r.nome === SUPER_ADMIN_ROLE_NAME && !user?.isSuperAdmin) return;
    setEditing(r);
    setNome(r.nome);
    setDescrizione(r.descrizione ?? "");
    setAree(r.aree ?? []);
    setIsAdmin(r.isAdmin);
    setFormError(null);
    setIsFormOpen(true);
  };

  const toggleArea = (key: string, checked: boolean) => {
    setAree((prev) =>
      checked ? [...prev, key] : prev.filter((a) => a !== key),
    );
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const data = {
      nome: nome.trim(),
      descrizione: descrizione.trim() || undefined,
      aree,
      isAdmin,
    };
    if (editing) {
      updateRuolo.mutate(
        { id: editing.id, data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: t("ruoli.toastUpdated") });
            setIsFormOpen(false);
          },
          onError: (err) => setFormError(extractError(err)),
        },
      );
    } else {
      createRuolo.mutate(
        { data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: t("ruoli.toastCreated") });
            setIsFormOpen(false);
          },
          onError: (err) => setFormError(extractError(err)),
        },
      );
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteRuolo.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: t("ruoli.toastDeleted") });
          setDeleting(null);
        },
        onError: (err) => {
          toast({
            title: t("ruoli.cannotDelete"),
            description: extractError(err),
            variant: "destructive",
          });
          setDeleting(null);
        },
      },
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("ruoli.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("ruoli.subtitle")}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {t("ruoli.newRole")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-0" />
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("ruoli.colAree")}</TableHead>
                  <TableHead>{t("common.type")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ruoli?.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.nome}</div>
                      {r.descrizione && (
                        <div className="text-xs text-muted-foreground">
                          {r.descrizione}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.isAdmin ? (
                        <span className="text-sm text-muted-foreground">
                          {t("ruoli.allAreas")}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.aree.length === 0 && (
                            <span className="text-sm text-muted-foreground">
                              —
                            </span>
                          )}
                          {r.aree.map((a) => (
                            <Badge key={a} variant="secondary">
                              {AREA_LABEL[a] ?? a}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.nome === SUPER_ADMIN_ROLE_NAME ? (
                        <Badge className="bg-amber-500/10 text-amber-700">
                          <ShieldCheck className="mr-1 h-3 w-3" />
                          SuperAdmin
                        </Badge>
                      ) : r.isAdmin ? (
                        <Badge className="bg-amber-500/10 text-amber-700">
                          <ShieldCheck className="mr-1 h-3 w-3" />
                          {t("ruoli.admin")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{t("ruoli.standard")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={r.nome === SUPER_ADMIN_ROLE_NAME && !user?.isSuperAdmin}
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={r.nome === SUPER_ADMIN_ROLE_NAME}
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {ruoli?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground py-8"
                    >
                      {t("ruoli.emptyRoles")}
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
              {editing ? t("ruoli.editRole") : t("ruoli.newRole")}
            </SheetTitle>
          </SheetHeader>
          <form onSubmit={onSubmit} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label htmlFor="r-nome">{t("ruoli.roleName")}</Label>
              <Input
                id="r-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                disabled={editing?.nome === SUPER_ADMIN_ROLE_NAME}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-descr">{t("common.description")}</Label>
              <Input
                id="r-descr"
                value={descrizione}
                onChange={(e) => setDescrizione(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="r-admin">{t("ruoli.admin")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("ruoli.adminDesc")}
                </p>
              </div>
              <Switch
                id="r-admin"
                checked={isAdmin}
                onCheckedChange={setIsAdmin}
                disabled={editing?.nome === SUPER_ADMIN_ROLE_NAME}
              />
            </div>
            {!isAdmin && (
              <div className="space-y-2">
                <Label>{t("ruoli.accessibleAreas")}</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {ALL_AREAS.filter((a) => a.key !== "amministrazione").map(
                    (a) => (
                      <div key={a.key} className="flex items-center gap-2">
                        <Checkbox
                          id={`area-${a.key}`}
                          checked={aree.includes(a.key)}
                          onCheckedChange={(c) =>
                            toggleArea(a.key, c === true)
                          }
                        />
                        <Label
                          htmlFor={`area-${a.key}`}
                          className="font-normal cursor-pointer"
                        >
                          {a.label}
                        </Label>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={createRuolo.isPending || updateRuolo.isPending}
            >
              {editing ? t("ruoli.saveChanges") : t("ruoli.createRole")}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ruoli.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("ruoli.deleteDescBefore")}{" "}
              <span className="font-medium">{deleting?.nome}</span>{" "}
              {t("ruoli.deleteDescAfter")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
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
  return i18n.t("ruoli.operationFailed");
}
