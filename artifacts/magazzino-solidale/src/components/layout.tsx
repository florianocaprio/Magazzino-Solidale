import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Warehouse,
  Package,
  PackageMinus,
  Boxes,
  PackageCheck,
  ArrowRightLeft,
  TrendingUpDown,
  Users,
  ClipboardList,
  Truck,
  FileText,
  UsersRound,
  Car,
  Store,
  CreditCard,
  ReceiptText,
  ShoppingCart,
  BarChart3,
  Building2,
  MapPin,
  Map,
  Footprints,
  HeartHandshake,
  HandHeart,
  CalendarClock,
  CalendarDays,
  Printer,
  ShieldCheck,
  ClipboardCheck,
  UserCog,
  Contact,
  ListChecks,
  SlidersHorizontal,
  Languages,
  ChevronDown,
  LogOut,
  ScanLine,
  Soup,
  FileWarning,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import {
  canAccessMapsApplication,
  canShowMapsNavigation,
} from "@/lib/maps-access";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/lib/i18n";
import { useConfigurazioneAmbienteFlags } from "@/lib/use-moduli";
import {
  getGetMapsCapabilitiesQueryKey,
  useGetMapsCapabilities,
} from "@workspace/api-client-react";
import { canManageGlobalAdminResources } from "@/lib/admin-scope";

export type NavItem = {
  key: string;
  url: string;
  icon: LucideIcon;
  groupKey: string;
  area?: string | readonly string[];
  moduloCodice?: string;
  moduloCodiciAll?: readonly string[];
  moduloCodiciAny?: readonly string[];
  superAdmin?: boolean;
  globalAdmin?: boolean;
  public?: boolean;
  permission?: string;
  sourceAreas?: readonly string[];
  requiresMapsLayer?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    key: "dashboard",
    url: "/",
    icon: LayoutDashboard,
    groupKey: "generale",
    area: "generale",
  },
  {
    key: "magazzini",
    url: "/magazzini",
    icon: Warehouse,
    groupKey: "amministrazione",
    area: "amministrazione",
  },
  {
    key: "prodotti",
    url: "/prodotti",
    icon: Package,
    groupKey: "magazzino",
    area: "magazzino",
    permission: "magazzino.view",
  },
  {
    key: "lotti",
    url: "/lotti",
    icon: Boxes,
    groupKey: "magazzino",
    area: "magazzino",
    moduloCodice: "LOTTI",
    permission: "magazzino.view",
  },
  {
    key: "movimenti",
    url: "/movimenti",
    icon: ArrowRightLeft,
    groupKey: "magazzino",
    area: "magazzino",
    permission: "magazzino.view",
  },
  {
    key: "giacenze",
    url: "/giacenze",
    icon: TrendingUpDown,
    groupKey: "magazzino",
    area: "magazzino",
    permission: "magazzino.view",
  },
  {
    key: "trasferimenti",
    url: "/trasferimenti",
    icon: ArrowRightLeft,
    groupKey: "magazzino",
    area: "magazzino",
    moduloCodice: "TRASFERIMENTI",
    permission: "magazzino.view",
  },
  {
    key: "preparazioneConsegne",
    url: "/preparazione-consegne",
    icon: PackageCheck,
    groupKey: "magazzino",
    area: "magazzino",
    moduloCodice: "MAGAZZINO_SOLIDALE",
    permission: "magazzino.view",
  },

  {
    key: "centriAscolto",
    url: "/centri-ascolto",
    icon: Building2,
    groupKey: "amministrazione",
    area: "amministrazione",
    moduloCodiciAny: [
      "CENTRO_ASCOLTO",
      "EMPORIO_SOLIDALE",
      "MENSA",
      "CREDITO_SOLIDALE",
    ],
  },
  {
    key: "beneficiari",
    url: "/beneficiari",
    icon: Users,
    groupKey: "sociale",
    area: "sociale",
    moduloCodice: "CENTRO_ASCOLTO",
    permission: "beneficiari.view",
  },
  {
    key: "interventi",
    url: "/interventi",
    icon: ClipboardList,
    groupKey: "sociale",
    area: "sociale",
    moduloCodice: "CENTRO_ASCOLTO",
    permission: "sociale.interventi.view",
  },
  {
    key: "consegne",
    url: "/consegne",
    icon: Truck,
    groupKey: "sociale",
    area: "sociale",
    moduloCodiciAll: ["CENTRO_ASCOLTO", "CONSEGNE"],
  },
  {
    key: "bolle",
    url: "/bolle",
    icon: FileText,
    groupKey: "magazzino",
    area: ["sociale", "magazzino"],
    moduloCodiciAll: ["MAGAZZINO_SOLIDALE", "BOLLE"],
    permission: "bolle.view",
  },
  {
    key: "turni",
    url: "/turni",
    icon: CalendarDays,
    groupKey: "sociale",
    area: "sociale",
    moduloCodice: "CENTRO_ASCOLTO",
    permission: "logistica.turni.view",
  },
  {
    key: "scarichi",
    url: "/scarichi",
    icon: PackageMinus,
    groupKey: "magazzino",
    area: "magazzino",
    moduloCodice: "SCARICHI",
    permission: "magazzino.view",
  },

  {
    key: "emporioCassa",
    url: "/emporio/cassa",
    icon: Store,
    groupKey: "emporio",
    area: "emporio",
    moduloCodice: "EMPORIO_SOLIDALE",
    permission: "emporio.cassa.view",
  },
  {
    key: "emporioCreditiSaldo",
    url: "/emporio/crediti-saldo",
    icon: CreditCard,
    groupKey: "emporio",
    area: "emporio",
    moduloCodiciAll: ["EMPORIO_SOLIDALE", "CREDITO_SOLIDALE"],
    permission: "credito.view",
  },
  {
    key: "politicheCreditoSolidale",
    url: "/politiche-credito-solidale",
    icon: SlidersHorizontal,
    groupKey: "emporio",
    area: "amministrazione",
    moduloCodiciAll: ["EMPORIO_SOLIDALE", "CREDITO_SOLIDALE"],
  },
  {
    key: "emporioAccessi",
    url: "/emporio/accessi",
    icon: CalendarClock,
    groupKey: "emporio",
    area: "emporio",
    moduloCodice: "EMPORIO_SOLIDALE",
    permission: "emporio.access.view",
  },
  {
    key: "emporioSpese",
    url: "/emporio/spese",
    icon: ReceiptText,
    groupKey: "emporio",
    area: "emporio",
    moduloCodice: "EMPORIO_SOLIDALE",
    permission: "emporio.sales.view",
  },

  {
    key: "mensaPostazione",
    url: "/mensa/postazione",
    icon: ScanLine,
    groupKey: "mensa",
    area: "mensa",
    moduloCodice: "MENSA",
    permission: "mensa.access.scan",
  },
  {
    key: "mensaPasti",
    url: "/mensa/pasti",
    icon: Soup,
    groupKey: "mensa",
    area: "mensa",
    moduloCodice: "MENSA",
    permission: "mensa.view",
  },
  {
    key: "mensaAbilitazioni",
    url: "/mensa/abilitazioni",
    icon: ShieldCheck,
    groupKey: "mensa",
    area: "mensa",
    moduloCodice: "MENSA",
    permission: "mensa.eligibility.manage",
  },
  {
    key: "mensaTrasferimenti",
    url: "/mensa/trasferimenti",
    icon: ArrowRightLeft,
    groupKey: "mensa",
    area: "mensa",
    moduloCodice: "MENSA",
    permission: "mensa.transfers.request",
  },
  {
    key: "mensaConsumi",
    url: "/mensa/consumi",
    icon: PackageMinus,
    groupKey: "mensa",
    area: "mensa",
    moduloCodice: "MENSA",
    permission: "mensa.consumption.manage",
  },
  {
    key: "mensaEccezioni",
    url: "/mensa/eccezioni",
    icon: FileWarning,
    groupKey: "mensa",
    area: "mensa",
    moduloCodice: "MENSA",
    permission: "mensa.view",
  },
  {
    key: "mensaReport",
    url: "/mensa/report",
    icon: BarChart3,
    groupKey: "mensa",
    area: "mensa",
    moduloCodice: "MENSA",
    permission: "mensa.reports.view",
  },

  {
    key: "udsAnagrafica",
    url: "/uds/anagrafica",
    icon: Footprints,
    groupKey: "uds",
    area: "uds",
    moduloCodice: "UDS",
    permission: "uds.directory.view",
  },
  {
    key: "udsInterventi",
    url: "/uds/interventi",
    icon: HeartHandshake,
    groupKey: "uds",
    area: "uds",
    moduloCodice: "UDS",
    permission: "uds.interventi.view",
  },
  {
    key: "udsReportGiornaliero",
    url: "/uds/report-giornaliero",
    icon: CalendarClock,
    groupKey: "uds",
    area: "uds",
    moduloCodice: "UDS",
    permission: "uds.reports.view",
  },

  {
    key: "volontari",
    url: "/volontari",
    icon: UsersRound,
    groupKey: "logistica",
    area: "logistica",
    moduloCodice: "VOLONTARI",
    permission: "logistica.volontari.view",
  },
  {
    key: "mezzi",
    url: "/mezzi",
    icon: Car,
    groupKey: "logistica",
    area: "logistica",
    moduloCodice: "MEZZI",
    permission: "logistica.mezzi.view",
  },
  {
    key: "approvazioniLogistica",
    url: "/approvazioni-logistica",
    icon: ClipboardCheck,
    groupKey: "logistica",
    area: "logistica",
    moduloCodiciAny: ["VOLONTARI", "MEZZI"],
    permission: "logistica.approvazioni.view",
  },
  {
    key: "fornitori",
    url: "/fornitori",
    icon: Store,
    groupKey: "logistica",
    area: "logistica",
    moduloCodice: "FORNITORI",
  },
  {
    key: "approvvigionamenti",
    url: "/approvvigionamenti",
    icon: ShoppingCart,
    groupKey: "logistica",
    area: "logistica",
    moduloCodice: "APPROVVIGIONAMENTI",
    permission: "approvvigionamenti.view",
  },
  {
    key: "maps",
    url: "/maps",
    icon: Map,
    groupKey: "logistica",
    area: ["sociale", "magazzino"],
    permission: "maps.operational",
    requiresMapsLayer: true,
  },

  {
    key: "report",
    url: "/report",
    icon: BarChart3,
    groupKey: "analisi",
    area: "analisi",
    moduloCodice: "REPORT",
  },
  {
    key: "reportDashboard",
    url: "/report/dashboard",
    icon: BarChart3,
    groupKey: "analisi",
    area: "analisi",
    moduloCodice: "REPORT",
  },
  {
    key: "reportPacchi",
    url: "/report/pacchi",
    icon: PackageCheck,
    groupKey: "analisi",
    area: "analisi",
    sourceAreas: ["sociale"],
    moduloCodiciAll: ["REPORT", "MAGAZZINO_SOLIDALE", "BOLLE"],
  },
  {
    key: "reportCentroAscolto",
    url: "/report/centro-ascolto",
    icon: Building2,
    groupKey: "analisi",
    area: "analisi",
    sourceAreas: ["sociale"],
    moduloCodiciAll: ["CENTRO_ASCOLTO", "REPORT"],
  },
  {
    key: "reportEmporio",
    url: "/report/emporio",
    icon: Store,
    groupKey: "analisi",
    area: "analisi",
    sourceAreas: ["emporio"],
    moduloCodiciAll: ["REPORT", "EMPORIO_SOLIDALE"],
  },
  {
    key: "reportMensa",
    url: "/report/mensa",
    icon: Soup,
    groupKey: "analisi",
    area: "analisi",
    sourceAreas: ["mensa"],
    moduloCodiciAll: ["REPORT", "MENSA"],
    permission: "mensa.reports.view",
  },
  {
    key: "reportUds",
    url: "/report/uds",
    icon: Footprints,
    groupKey: "analisi",
    area: "analisi",
    sourceAreas: ["uds"],
    moduloCodiciAll: ["REPORT", "UDS"],
    permission: "uds.reports.view",
  },
  {
    key: "reportLogistica",
    url: "/report/magazzino-logistica",
    icon: Warehouse,
    groupKey: "analisi",
    area: "analisi",
    sourceAreas: ["magazzino", "logistica"],
    moduloCodice: "REPORT",
    moduloCodiciAny: [
      "MAGAZZINO_SOLIDALE",
      "LOTTI",
      "TRASFERIMENTI",
      "MEZZI",
      "FORNITORI",
      "APPROVVIGIONAMENTI",
    ],
  },
  {
    key: "reportFsePlus",
    url: "/report/fse-plus",
    icon: Boxes,
    groupKey: "analisi",
    area: "analisi",
    moduloCodice: "REPORT",
  },

  {
    key: "areeOperative",
    url: "/aree-operative",
    icon: MapPin,
    groupKey: "amministrazione",
    area: "amministrazione",
    globalAdmin: true,
  },
  {
    key: "zoneUds",
    url: "/zone-uds",
    icon: Map,
    groupKey: "amministrazione",
    area: "amministrazione",
    moduloCodice: "UDS",
    permission: "uds.directory.view",
  },
  {
    key: "utenti",
    url: "/utenti",
    icon: UserCog,
    groupKey: "amministrazione",
    area: "amministrazione",
  },
  {
    key: "ruoli",
    url: "/ruoli",
    icon: ShieldCheck,
    groupKey: "amministrazione",
    area: "amministrazione",
    globalAdmin: true,
  },
  {
    key: "ruoliVolontari",
    url: "/ruoli-volontari",
    icon: Contact,
    groupKey: "amministrazione",
    area: "amministrazione",
    moduloCodice: "VOLONTARI",
    globalAdmin: true,
  },
  {
    key: "tipiIntervento",
    url: "/tipi-intervento",
    icon: ListChecks,
    groupKey: "amministrazione",
    area: "amministrazione",
    moduloCodiciAny: ["CENTRO_ASCOLTO", "UDS"],
    globalAdmin: true,
  },
  {
    key: "tipologieFornitore",
    url: "/tipologie-fornitore",
    icon: Truck,
    groupKey: "amministrazione",
    area: "amministrazione",
    moduloCodice: "FORNITORI",
    globalAdmin: true,
  },
  {
    key: "impostazioniStampa",
    url: "/impostazioni-stampa",
    icon: Printer,
    groupKey: "amministrazione",
    area: "amministrazione",
    globalAdmin: true,
  },

  {
    key: "sostieniProgetto",
    url: "/sostieni-progetto",
    icon: HandHeart,
    groupKey: "supporto",
    public: true,
  },

  {
    key: "superAdminConfigurazioneAmbiente",
    url: "/super-admin/configurazione-ambiente",
    icon: Building2,
    groupKey: "superAdmin",
    superAdmin: true,
  },
  {
    key: "superAdminModuli",
    url: "/super-admin/moduli",
    icon: SlidersHorizontal,
    groupKey: "superAdmin",
    superAdmin: true,
  },
  {
    key: "superAdminAudit",
    url: "/super-admin/audit-configurazioni",
    icon: FileText,
    groupKey: "superAdmin",
    superAdmin: true,
  },
  {
    key: "superAdminLogSistema",
    url: "/super-admin/log-sistema",
    icon: ClipboardList,
    groupKey: "superAdmin",
    superAdmin: true,
  },
];

function LanguageSelector() {
  const { t, i18n } = useTranslation();
  return (
    <Select value={i18n.language} onValueChange={(v) => i18n.changeLanguage(v)}>
      <SelectTrigger
        className="h-9 w-full gap-2"
        aria-label={t("common.language")}
      >
        <Languages className="h-4 w-4 shrink-0 text-muted-foreground" />
        <SelectValue placeholder={t("common.language")} />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NavMenuLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const { t } = useTranslation();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton asChild isActive={isActive}>
      <Link
        href={item.url}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
        }}
        className="flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors"
      >
        <item.icon className="h-4 w-4" />
        <span>
          {item.groupKey === "mensa"
            ? t(`mensa.nav.${item.key}`)
            : t(`nav.items.${item.key}`)}
        </span>
      </Link>
    </SidebarMenuButton>
  );
}

export function isNavItemEnabledByModules(
  item: NavItem,
  isModuloAttivo: (codice?: string | null) => boolean,
): boolean {
  if (item.moduloCodice && !isModuloAttivo(item.moduloCodice)) return false;
  if (
    item.moduloCodiciAll &&
    !item.moduloCodiciAll.every((codice) => isModuloAttivo(codice))
  ) {
    return false;
  }
  if (
    item.moduloCodiciAny &&
    !item.moduloCodiciAny.some((codice) => isModuloAttivo(codice))
  ) {
    return false;
  }
  return true;
}

export function isNavItemEnabledByCapabilities(
  item: NavItem,
  mapsLayerCount: number,
): boolean {
  return !item.requiresMapsLayer || mapsLayerCount > 0;
}

export function isNavItemEnabledByAccess(
  item: NavItem,
  hasArea: (area: string) => boolean,
  hasPermission: (permission: string) => boolean,
): boolean {
  const itemAreas = Array.isArray(item.area)
    ? item.area
    : item.area
      ? [item.area]
      : [];
  return (
    itemAreas.some(hasArea) &&
    (!item.sourceAreas || item.sourceAreas.some(hasArea)) &&
    (!item.permission || hasPermission(item.permission))
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, hasArea, hasPermission, logout } = useAuth();
  const { t } = useTranslation();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  const canAskMaps = canAccessMapsApplication(user, hasArea, hasPermission);
  const { data: mapsCapabilities } = useGetMapsCapabilities({
    query: {
      queryKey: getGetMapsCapabilitiesQueryKey(),
      enabled: canAskMaps,
      staleTime: 5 * 60 * 1000,
    },
  });

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.superAdmin) return user?.isSuperAdmin === true;
    if (item.globalAdmin && !canManageGlobalAdminResources(user)) return false;
    if (item.public) return true;
    if (item.key === "maps") {
      return canShowMapsNavigation(
        user,
        hasArea,
        hasPermission,
        mapsCapabilities?.layers.length ?? 0,
      );
    }
    return (
      isNavItemEnabledByAccess(item, hasArea, hasPermission) &&
      isNavItemEnabledByCapabilities(item, mapsCapabilities?.layers.length ?? 0)
    );
  }).filter((item) => isNavItemEnabledByModules(item, isModuloAttivo));

  const groupedNav = visibleItems.reduce(
    (acc, item) => {
      if (!acc[item.groupKey]) acc[item.groupKey] = [];
      acc[item.groupKey].push(item);
      return acc;
    },
    {} as Record<string, NavItem[]>,
  );

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar className="border-r border-border">
          <div className="px-4 py-3 flex items-center border-b border-border">
            <img
              src="/logo-aim.png"
              alt="Angeli in Moto"
              className="h-8 w-auto object-contain"
            />
          </div>
          <SidebarContent>
            {Object.entries(groupedNav).map(([group, items]) => (
              <Collapsible
                key={group}
                defaultOpen
                className="group/collapsible"
              >
                <SidebarGroup>
                  <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="flex w-full items-center justify-between text-xs uppercase tracking-wider text-muted-foreground font-medium px-4 py-2 hover:text-foreground transition-colors">
                      {group === "mensa"
                        ? t("mensa.nav.group")
                        : t(`nav.groups.${group}`)}
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=closed]/collapsible:-rotate-90" />
                    </CollapsibleTrigger>
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {items.map((item) => (
                          <SidebarMenuItem key={item.url}>
                            <NavMenuLink
                              item={item}
                              isActive={
                                location === item.url ||
                                (item.url !== "/" &&
                                  item.url !== "/report" &&
                                  location.startsWith(item.url))
                              }
                            />
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            ))}
          </SidebarContent>
          <SidebarFooter className="border-t border-border">
            <div className="px-2 pt-2">
              <LanguageSelector />
            </div>
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {[user?.nome, user?.cognome].filter(Boolean).join(" ")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.ruoloNome ?? t("common.noRole")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                title={t("common.logout")}
                aria-label={t("common.logout")}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 md:hidden">
            <SidebarTrigger
              className="h-9 w-9"
              aria-label={t("common.openMenu")}
            />
            <img
              src="/logo-aim.png"
              alt="Angeli in Moto"
              className="h-7 w-auto object-contain"
            />
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
