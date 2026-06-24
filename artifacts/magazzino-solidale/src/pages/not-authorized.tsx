import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function NotAuthorized() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">{t("notAuthorized.title")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("notAuthorized.message")}
      </p>
    </div>
  );
}
