import { Link } from "wouter";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarClock, CreditCard, Store, type LucideIcon } from "lucide-react";

function Placeholder({
  title,
  text,
  icon: Icon,
  action,
}: {
  title: string;
  text: string;
  icon: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Icon className="h-5 w-5 text-muted-foreground" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{text}</p>
          {action}
        </CardContent>
      </Card>
    </div>
  );
}

export function EmporioCassa() {
  const { t } = useTranslation();
  return <Placeholder title={t("emporio.cassaTitle")} text={t("emporio.cassaText")} icon={Store} />;
}

export function EmporioCreditiSaldo() {
  const { t } = useTranslation();
  return <Placeholder title={t("emporio.creditiTitle")} text={t("emporio.creditiText")} icon={CreditCard} />;
}

export function EmporioAccessi() {
  const { t } = useTranslation();
  return (
    <Placeholder
      title={t("emporio.accessiTitle")}
      text={t("emporio.accessiText")}
      icon={CalendarClock}
      action={
        <Button asChild>
          <Link href="/consegne">{t("emporio.vaiPianificazione")}</Link>
        </Button>
      }
    />
  );
}
