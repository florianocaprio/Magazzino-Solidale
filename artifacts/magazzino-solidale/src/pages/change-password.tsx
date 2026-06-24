import { useState } from "react";
import { useChangePassword } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function ChangePassword() {
  const { t } = useTranslation();
  const { refresh, logout, user } = useAuth();
  const changePassword = useChangePassword();
  const { toast } = useToast();
  const forced = user?.mustChangePassword ?? false;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError(t("changePassword.errorMinLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("changePassword.errorMismatch"));
      return;
    }
    changePassword.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast({ title: t("changePassword.toastUpdated") });
          refresh();
        },
        onError: () => {
          setError(t("changePassword.errorCurrentWrong"));
        },
      },
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="pt-8">
          <h1 className="text-lg font-semibold">
            {forced ? t("changePassword.titleForced") : t("changePassword.titleNormal")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {forced
              ? t("changePassword.subtitleForced")
              : t("changePassword.subtitleNormal")}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">{t("changePassword.currentPassword")}</Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">{t("changePassword.newPassword")}</Label>
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">{t("changePassword.confirmPassword")}</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={changePassword.isPending}
            >
              {changePassword.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("changePassword.savePassword")}
            </Button>
            {forced && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={logout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {t("common.logout")}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
