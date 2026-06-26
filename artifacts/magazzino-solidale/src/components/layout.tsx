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
  ShoppingCart,
  BarChart3,
  Building2,
  MapPin,
  Map,
  Footprints,
  HeartHandshake,
  CalendarClock,
  Printer,
  ShieldCheck,
  UserCog,
  Contact,
  ListChecks,
  Languages,
  ChevronDown,
  LogOut
} from "lucide-react";
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
  useSidebar
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
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/lib/i18n";

const NAV_ITEMS = [
  { key: "dashboard", url: "/", icon: LayoutDashboard, groupKey: "generale", area: "generale" },
  { key: "magazzini", url: "/magazzini", icon: Warehouse, groupKey: "magazzino", area: "magazzino" },
  { key: "prodotti", url: "/prodotti", icon: Package, groupKey: "magazzino", area: "magazzino" },
  { key: "lotti", url: "/lotti", icon: Boxes, groupKey: "magazzino", area: "magazzino" },
  { key: "movimenti", url: "/movimenti", icon: ArrowRightLeft, groupKey: "magazzino", area: "magazzino" },
  { key: "giacenze", url: "/giacenze", icon: TrendingUpDown, groupKey: "magazzino", area: "magazzino" },
  { key: "trasferimenti", url: "/trasferimenti", icon: ArrowRightLeft, groupKey: "magazzino", area: "magazzino" },
  { key: "preparazioneConsegne", url: "/preparazione-consegne", icon: PackageCheck, groupKey: "magazzino", area: "magazzino" },
  
  { key: "centriAscolto", url: "/centri-ascolto", icon: Building2, groupKey: "sociale", area: "sociale" },
  { key: "beneficiari", url: "/beneficiari", icon: Users, groupKey: "sociale", area: "sociale" },
  { key: "interventi", url: "/interventi", icon: ClipboardList, groupKey: "sociale", area: "sociale" },
  { key: "consegne", url: "/consegne", icon: Truck, groupKey: "sociale", area: "sociale" },
  { key: "bolle", url: "/bolle", icon: FileText, groupKey: "sociale", area: "sociale" },
  { key: "scarichi", url: "/scarichi", icon: PackageMinus, groupKey: "sociale", area: "sociale" },

  { key: "udsAnagrafica", url: "/uds/anagrafica", icon: Footprints, groupKey: "uds", area: "uds" },
  { key: "udsInterventi", url: "/uds/interventi", icon: HeartHandshake, groupKey: "uds", area: "uds" },
  { key: "udsReportGiornaliero", url: "/uds/report-giornaliero", icon: CalendarClock, groupKey: "uds", area: "uds" },

  { key: "volontari", url: "/volontari", icon: UsersRound, groupKey: "logistica", area: "logistica" },
  { key: "mezzi", url: "/mezzi", icon: Car, groupKey: "logistica", area: "logistica" },
  { key: "fornitori", url: "/fornitori", icon: Store, groupKey: "logistica", area: "logistica" },
  { key: "approvvigionamenti", url: "/approvvigionamenti", icon: ShoppingCart, groupKey: "logistica", area: "logistica" },
  
  { key: "report", url: "/report", icon: BarChart3, groupKey: "analisi", area: "analisi" },
  { key: "reportUds", url: "/report-uds", icon: Footprints, groupKey: "analisi", area: "analisi" },

  { key: "citta", url: "/citta", icon: MapPin, groupKey: "amministrazione", area: "amministrazione" },
  { key: "zoneUds", url: "/zone-uds", icon: Map, groupKey: "amministrazione", area: "amministrazione" },
  { key: "utenti", url: "/utenti", icon: UserCog, groupKey: "amministrazione", area: "amministrazione" },
  { key: "ruoli", url: "/ruoli", icon: ShieldCheck, groupKey: "amministrazione", area: "amministrazione" },
  { key: "ruoliVolontari", url: "/ruoli-volontari", icon: Contact, groupKey: "amministrazione", area: "amministrazione" },
  { key: "tipiIntervento", url: "/tipi-intervento", icon: ListChecks, groupKey: "amministrazione", area: "amministrazione" },
  { key: "impostazioniStampa", url: "/impostazioni-stampa", icon: Printer, groupKey: "amministrazione", area: "amministrazione" },
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

function NavMenuLink({ item, isActive }: { item: (typeof NAV_ITEMS)[number]; isActive: boolean }) {
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
        <span>{t(`nav.items.${item.key}`)}</span>
      </Link>
    </SidebarMenuButton>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, hasArea, logout } = useAuth();
  const { t } = useTranslation();

  const visibleItems = NAV_ITEMS.filter((item) => hasArea(item.area));

  const groupedNav = visibleItems.reduce((acc, item) => {
    if (!acc[item.groupKey]) acc[item.groupKey] = [];
    acc[item.groupKey].push(item);
    return acc;
  }, {} as Record<string, typeof NAV_ITEMS>);

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar className="border-r border-border">
          <div className="px-4 py-3 flex items-center border-b border-border">
            <img src="/logo-aim.png" alt="Angeli in Moto" className="h-8 w-auto object-contain" />
          </div>
          <SidebarContent>
            {Object.entries(groupedNav).map(([group, items]) => (
              <Collapsible key={group} defaultOpen className="group/collapsible">
                <SidebarGroup>
                  <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="flex w-full items-center justify-between text-xs uppercase tracking-wider text-muted-foreground font-medium px-4 py-2 hover:text-foreground transition-colors">
                      {t(`nav.groups.${group}`)}
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
                              isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}
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
                <p className="truncate text-sm font-medium">{[user?.nome, user?.cognome].filter(Boolean).join(" ")}</p>
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
            <img src="/logo-aim.png" alt="Angeli in Moto" className="h-7 w-auto object-contain" />
          </header>
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
