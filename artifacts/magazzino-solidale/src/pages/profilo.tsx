import { useState } from "react";
import { useUpdateMyProfile } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ChangePassword from "./change-password";

export default function Profilo() {
  const { user, refresh } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [email, setEmail] = useState(user?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateMyProfile();
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
        <p className="text-muted-foreground">
          {[user?.nome, user?.cognome].filter(Boolean).join(" ")} ·{" "}
          {user?.username}
        </p>
        {!!user?.permessiSpeciali?.length && (
          <div className="mt-3 space-y-2">
            <Badge variant="secondary">{t("profile.specialUser")}</Badge>
            <p className="text-sm text-muted-foreground">{t("profile.specialUserDescription")}</p>
          </div>
        )}
      </header>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t("profile.emailTitle")}</h2>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              update.mutate(
                { data: { email: email.trim().toLowerCase() } },
                {
                  onSuccess: async () => {
                    setEmail(email.trim().toLowerCase());
                    await refresh();
                    toast({ title: t("profile.emailSaved") });
                  },
                  onError: (failure) =>
                    setError(errorMessage(failure, t("profile.emailError"))),
                },
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="profile-email">{t("profile.emailTitle")}</Label>
              <Input
                id="profile-email"
                type="email"
                autoComplete="email"
                maxLength={255}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={update.isPending}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={
                update.isPending ||
                (!user?.emailDaAggiornare &&
                  email.trim().toLowerCase() === user?.email)
              }
            >
              {t(update.isPending ? "profile.saving" : "profile.saveEmail")}
            </Button>
          </form>
        </CardContent>
      </Card>
      <ChangePassword embedded />
    </div>
  );
}
