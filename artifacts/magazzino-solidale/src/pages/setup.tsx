import { useEffect, useMemo, useState } from "react";
import { useListRuoli, useListUtenti, useCreateUtente } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Setup() {
  const { t } = useTranslation();
  const { refreshBootstrap } = useAuth();
  const { toast } = useToast();

  const rolesQuery = useListRuoli();
  const usersQuery = useListUtenti();
  const createUser = useCreateUtente();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [password, setPassword] = useState("");
  const [ruoloId, setRuoloId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const roles = rolesQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const superAdminRole = roles.find((r) => r.nome === "SuperAdmin");
  const isFirstUser = users.length === 0;
  const adminExists = users.some((u) => {
    const role = roles.find((r) => r.id === u.ruoloId);
    return role?.isAdmin ?? false;
  });

  useEffect(() => {
    if (isFirstUser && superAdminRole && !ruoloId) {
      setRuoloId(String(superAdminRole.id));
    }
  }, [isFirstUser, ruoloId, superAdminRole]);

  const selectedRole = useMemo(() => roles.find((r) => String(r.id) === ruoloId), [roles, ruoloId]);
  const creatingAdmin = selectedRole?.isAdmin ?? false;

  const resetForm = () => {
    setUsername("");
    setEmail("");
    setNome("");
    setCognome("");
    setPassword("");
    setRuoloId("");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!ruoloId) {
      setError(t("setup.errorRoleRequired"));
      return;
    }
    if (password.length < 6) {
      setError(t("setup.errorPasswordMin"));
      return;
    }
    const willBeAdmin = creatingAdmin;
    createUser.mutate(
      {
        data: {
          username: username.trim(),
          email: email.trim(),
          nome: nome.trim(),
          cognome: cognome.trim(),
          password,
          ruoloId: Number(ruoloId),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: t("setup.toastCreated", { username: username.trim() }),
          });
          resetForm();
          if (willBeAdmin) {
            // Creating the first admin ends bootstrap mode: switch to login.
            toast({ title: t("setup.toastAdminDone") });
            refreshBootstrap();
          } else {
            usersQuery.refetch();
          }
        },
        onError: (err) => {
          const message = (err as { error?: string } | undefined)?.error ?? t("setup.errorGeneric");
          setError(message);
        },
      },
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-3xl grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-col items-center gap-3 pt-8">
            <img src="/logo-aim.png" alt="Angeli in Moto" className="h-12 w-auto object-contain" />
            <div className="text-center">
              <h1 className="text-lg font-semibold">{t("setup.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("setup.subtitle")}</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("setup.noticeAdminRequired")}</span>
              </div>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="nome">{t("setup.nome")}</Label>
                  <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cognome">{t("setup.cognome")}</Label>
                  <Input id="cognome" value={cognome} onChange={(e) => setCognome(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">{t("setup.username")}</Label>
                <Input id="username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("common.email")}</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("setup.password")}</Label>
                <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <p className="text-xs text-muted-foreground">{t("setup.passwordHint")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ruolo">{t("setup.role")}</Label>
                <Select value={ruoloId} onValueChange={setRuoloId}>
                  <SelectTrigger id="ruolo">
                    <SelectValue placeholder={t("setup.rolePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.nome}
                        {r.isAdmin ? ` — ${t("setup.adminBadge")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {creatingAdmin && <p className="text-xs text-amber-700 dark:text-amber-300">{t("setup.adminLockWarning")}</p>}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={createUser.isPending}>
                {createUser.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                {t("setup.createButton")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pt-8">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-base font-semibold">{t("setup.createdTitle")}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{adminExists ? t("setup.statusAdminReady") : t("setup.statusNoAdmin")}</p>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("setup.emptyList")}</p>
            ) : (
              <ul className="space-y-2">
                {users.map((u) => {
                  const role = roles.find((r) => r.id === u.ruoloId);
                  return (
                    <li key={u.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <div>
                        <div className="font-medium">{u.username}</div>
                        <div className="text-xs text-muted-foreground">
                          {[u.nome, u.cognome].filter(Boolean).join(" ")}
                          {role ? ` · ${role.nome}` : ""}
                        </div>
                      </div>
                      {role?.isAdmin && (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          {t("setup.adminBadge")}
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
