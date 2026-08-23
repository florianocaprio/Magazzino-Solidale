import { Link } from "wouter";
import {
  BarChart3,
  Boxes,
  Building2,
  Footprints,
  PackageCheck,
  Soup,
  Store,
  Warehouse,
  ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useConfigurazioneAmbienteFlags } from "@/lib/use-moduli";
import { useTranslation } from "react-i18next";

type LandingCard = {
  section: string;
  path: string;
  icon: LucideIcon;
  areas?: string[];
  modules?: string[];
  anyModule?: string[];
  permission?: string;
};

const CARDS: LandingCard[] = [
  { section: "generale", path: "/report/dashboard", icon: BarChart3 },
  { section: "pacchi", path: "/report/pacchi", icon: PackageCheck, areas: ["sociale"], modules: ["MAGAZZINO_SOLIDALE", "BOLLE"] },
  { section: "centro-ascolto", path: "/report/centro-ascolto", icon: Building2, areas: ["sociale"], modules: ["CENTRO_ASCOLTO"] },
  { section: "emporio", path: "/report/emporio", icon: Store, areas: ["emporio"], modules: ["EMPORIO_SOLIDALE"] },
  { section: "mensa", path: "/report/mensa", icon: Soup, areas: ["mensa"], modules: ["MENSA"], permission: "mensa.reports.view" },
  { section: "uds", path: "/report/uds", icon: Footprints, areas: ["uds"], modules: ["UDS"], permission: "uds.reports.view" },
  { section: "magazzino-logistica", path: "/report/magazzino-logistica", icon: Warehouse, areas: ["magazzino", "logistica"], anyModule: ["MAGAZZINO_SOLIDALE", "LOTTI", "TRASFERIMENTI", "MEZZI", "FORNITORI", "APPROVVIGIONAMENTI"] },
  {
    section: "fse-plus",
    path: "/report/fse-plus",
    icon: Boxes,
    areas: ["sociale", "emporio", "mensa", "uds", "magazzino", "logistica"],
    anyModule: ["MAGAZZINO_SOLIDALE", "BOLLE", "EMPORIO_SOLIDALE", "MENSA", "UDS"],
    permission: "magazzino.fse.view",
  },
];

export function isReportingCardVisible(
  card: LandingCard,
  checks: {
    hasArea: (area: string) => boolean;
    hasPermission: (permission: string) => boolean;
    isModuloAttivo: (code: string) => boolean;
  },
) {
  if (card.areas && !card.areas.some(checks.hasArea)) return false;
  if (card.permission && !checks.hasPermission(card.permission)) return false;
  if (card.modules && !card.modules.every(checks.isModuloAttivo)) return false;
  if (card.anyModule && !card.anyModule.some(checks.isModuloAttivo)) return false;
  return true;
}

export default function ReportingLanding() {
  const { t } = useTranslation();
  const { hasArea, hasPermission } = useAuth();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  const cards = CARDS.filter((card) => isReportingCardVisible(card, { hasArea, hasPermission, isModuloAttivo }));
  return (
    <div className="space-y-8 p-4 md:p-8">
      <header className="rounded-xl border bg-card p-6 md:p-8">
        <h1 className="text-3xl font-bold tracking-tight">{t("reporting.landing.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("reporting.landing.description")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.path} href={card.path} className="group block focus-visible:outline-none">
            <Card className="h-full transition-colors group-hover:border-primary group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <CardHeader className="flex flex-row items-center gap-3">
                <span className="rounded-lg bg-primary/10 p-2 text-primary"><card.icon className="h-6 w-6" /></span>
                <CardTitle>{t(`reporting.sections.${card.section}.title`)}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-4">
                <p className="text-sm text-muted-foreground">{t(`reporting.sections.${card.section}.description`)}</p>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
