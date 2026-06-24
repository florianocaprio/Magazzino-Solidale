import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Warehouse, 
  Package, 
  PackageMinus,
  Boxes, 
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
  Printer,
  ShieldCheck,
  UserCog,
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
  SidebarProvider
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

const NAV_ITEMS = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, group: "Generale", area: "generale" },
  { title: "Magazzini", url: "/magazzini", icon: Warehouse, group: "Magazzino", area: "magazzino" },
  { title: "Prodotti", url: "/prodotti", icon: Package, group: "Magazzino", area: "magazzino" },
  { title: "Lotti", url: "/lotti", icon: Boxes, group: "Magazzino", area: "magazzino" },
  { title: "Movimenti", url: "/movimenti", icon: ArrowRightLeft, group: "Magazzino", area: "magazzino" },
  { title: "Giacenze", url: "/giacenze", icon: TrendingUpDown, group: "Magazzino", area: "magazzino" },
  { title: "Trasferimenti", url: "/trasferimenti", icon: ArrowRightLeft, group: "Magazzino", area: "magazzino" },
  { title: "Scarichi", url: "/scarichi", icon: PackageMinus, group: "Magazzino", area: "magazzino" },
  
  { title: "Centri di Ascolto", url: "/centri-ascolto", icon: Building2, group: "Sociale", area: "sociale" },
  { title: "Beneficiari", url: "/beneficiari", icon: Users, group: "Sociale", area: "sociale" },
  { title: "Interventi", url: "/interventi", icon: ClipboardList, group: "Sociale", area: "sociale" },
  { title: "Consegne", url: "/consegne", icon: Truck, group: "Sociale", area: "sociale" },
  { title: "Bolle", url: "/bolle", icon: FileText, group: "Sociale", area: "sociale" },
  
  { title: "Volontari", url: "/volontari", icon: UsersRound, group: "Logistica", area: "logistica" },
  { title: "Mezzi", url: "/mezzi", icon: Car, group: "Logistica", area: "logistica" },
  { title: "Fornitori", url: "/fornitori", icon: Store, group: "Logistica", area: "logistica" },
  { title: "Approvvigionamenti", url: "/approvvigionamenti", icon: ShoppingCart, group: "Logistica", area: "logistica" },
  
  { title: "Report", url: "/report", icon: BarChart3, group: "Analisi", area: "analisi" },
  { title: "Impostazioni Stampa Bolla", url: "/impostazioni-stampa", icon: Printer, group: "Analisi", area: "analisi" },

  { title: "Utenti & Accessi", url: "/utenti", icon: UserCog, group: "Amministrazione", area: "amministrazione" },
  { title: "Ruoli", url: "/ruoli", icon: ShieldCheck, group: "Amministrazione", area: "amministrazione" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, hasArea, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter((item) => hasArea(item.area));

  const groupedNav = visibleItems.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
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
              <SidebarGroup key={group}>
                <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-4 py-2">
                  {group}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}>
                          <Link href={item.url} className="flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors">
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter className="border-t border-border">
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.ruoloNome ?? "Nessun ruolo"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                title="Esci"
                aria-label="Esci"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
