import { useState } from "react";
import { useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

function getResetToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
}

function validatePassword(newPassword: string, confirmPassword: string) {
  if (!newPassword || !confirmPassword) {
    return "passwordRecovery.errorPasswordRequired";
  }
  if (newPassword.length < 8) {
    return "passwordRecovery.errorPasswordMinLength";
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return "passwordRecovery.errorPasswordLetterNumber";
  }
  if (newPassword !== confirmPassword) {
    return "passwordRecovery.errorPasswordMismatch";
  }
  return null;
}

export default function ResetPassword() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const resetPassword = useResetPassword();
  const [token] = useState(getResetToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError(t("passwordRecovery.invalidLink"));
      return;
    }

    const validationError = validatePassword(newPassword, confirmPassword);
    if (validationError) {
      setError(t(validationError));
      return;
    }

    resetPassword.mutate(
      { data: { token, newPassword, confirmPassword } },
      {
        onSuccess: () => {
          setSuccess(true);
          setNewPassword("");
          setConfirmPassword("");
        },
        onError: () => {
          setError(t("passwordRecovery.resetInvalidOrExpired"));
        },
      },
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center gap-3 pt-8">
          <img
            src="/logo-aim.png"
            alt="Angeli in Moto"
            className="h-12 w-auto object-contain"
          />
          <div className="text-center">
            <h1 className="text-lg font-semibold">
              {t("passwordRecovery.resetTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("passwordRecovery.resetDescription")}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>
                  {t("passwordRecovery.invalidLink")}
                </AlertDescription>
              </Alert>
              <Button
                type="button"
                className="w-full"
                onClick={() => navigate("/login")}
              >
                {t("passwordRecovery.goToLogin")}
              </Button>
            </div>
          ) : success ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  {t("passwordRecovery.resetSuccess")}
                </AlertDescription>
              </Alert>
              <Button
                type="button"
                className="w-full"
                onClick={() => navigate("/login")}
              >
                {t("passwordRecovery.goToLogin")}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">
                  {t("passwordRecovery.newPassword")}
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">
                  {t("passwordRecovery.confirmPassword")}
                </Label>
                <Input
                  id="confirm-password"
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
                disabled={resetPassword.isPending}
              >
                {resetPassword.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("passwordRecovery.resetButton")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
