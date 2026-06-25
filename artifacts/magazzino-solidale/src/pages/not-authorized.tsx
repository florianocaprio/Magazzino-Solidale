import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";

export default function NotAuthorized() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const fullName = [user?.nome, user?.cognome].filter(Boolean).join(" ").trim();

  return (
    <div className="flex h-full min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <img
        src="/logo-aim.png"
        alt="Angeli in Moto"
        className="h-20 w-auto object-contain"
      />
      <h1 className="text-2xl font-semibold">
        {fullName
          ? t("notAuthorized.greeting", { name: fullName })
          : t("notAuthorized.welcome")}
      </h1>
      {user?.ruoloNome && (
        <p className="text-sm text-muted-foreground">
          {t("notAuthorized.role", { role: user.ruoloNome })}
        </p>
      )}
      <p className="max-w-md text-sm text-muted-foreground">
        {t("notAuthorized.useMenu")}
      </p>
    </div>
  );
}
