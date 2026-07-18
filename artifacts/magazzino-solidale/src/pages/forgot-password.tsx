import { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPassword() {
  const { t } = useTranslation();
  const forgotPassword = useForgotPassword();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError(t("passwordRecovery.errorEmailRequired"));
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError(t("passwordRecovery.errorEmailInvalid"));
      return;
    }

    forgotPassword.mutate(
      { data: { email: normalizedEmail } },
      {
        onSuccess: (data) => {
          setEmail(normalizedEmail);
          setMessage(data.message || t("passwordRecovery.forgotNeutral"));
        },
        onError: () => {
          setError(t("passwordRecovery.errorGeneric"));
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
              {t("passwordRecovery.forgotTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("passwordRecovery.forgotDescription")}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-email">
                {t("passwordRecovery.emailLabel")}
              </Label>
              <Input
                id="recovery-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("passwordRecovery.emailPlaceholder")}
                required
                autoFocus
              />
            </div>
            {message && (
              <Alert>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={forgotPassword.isPending}
            >
              {forgotPassword.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {forgotPassword.isPending
                ? t("passwordRecovery.sending")
                : t("passwordRecovery.sendLink")}
            </Button>
            <Link
              href="/login"
              className="block text-center text-sm text-muted-foreground hover:text-foreground"
            >
              {t("passwordRecovery.backToLogin")}
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
