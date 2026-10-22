import { useState } from "react";
import { useChangePassword } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { errorMessage } from "@/lib/api-error";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function ChangePassword({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const { refresh, logout, user } = useAuth();
  const changePassword = useChangePassword();
  const { toast } = useToast();
  const forced = user?.mustChangePassword ?? false;
  const Title = embedded ? "h2" : "h1";

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
      { data: { newPassword } },
      {
        onSuccess: () => {
          setNewPassword("");
          setConfirmPassword("");
          toast({ title: t("changePassword.toastUpdated") });
          refresh();
        },
        onError: (error) => {
          setError(errorMessage(error, t("changePassword.errorGeneric")));
        },
      },
    );
  };

  const content = (
    <Card className={embedded ? "w-full" : "w-full max-w-sm"}>
      <CardHeader className="pt-8">
        <Title className="text-lg font-semibold">
          {forced
            ? t("changePassword.titleForced")
            : t("changePassword.titleNormal")}
        </Title>
        <p className="text-sm text-muted-foreground">
          {forced
            ? t("changePassword.subtitleForced")
            : t("changePassword.subtitleNormal")}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new">{t("changePassword.newPassword")}</Label>
            <PasswordInput
              id="new"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus={!embedded}
              disabled={changePassword.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">
              {t("changePassword.confirmPassword")}
            </Label>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={changePassword.isPending}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
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
  );
  return embedded ? (
    content
  ) : (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      {content}
    </div>
  );
}
