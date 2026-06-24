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
  Printer
} from "lucide-react";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarMenu, 
  SidebarMenuButton, 
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, group: "Generale" },
  { title: "Magazzini", url: "/magazzini", icon: Warehouse, group: "Magazzino" },
  { title: "Prodotti", url: "/prodotti", icon: Package, group: "Magazzino" },
  { title: "Lotti", url: "/lotti", icon: Boxes, group: "Magazzino" },
  { title: "Movimenti", url: "/movimenti", icon: ArrowRightLeft, group: "Magazzino" },
  { title: "Giacenze", url: "/giacenze", icon: TrendingUpDown, group: "Magazzino" },
  { title: "Trasferimenti", url: "/trasferimenti", icon: ArrowRightLeft, group: "Magazzino" },
  { title: "Scarichi", url: "/scarichi", icon: PackageMinus, group: "Magazzino" },
  
  { title: "Centri di Ascolto", url: "/centri-ascolto", icon: Building2, group: "Sociale" },
  { title: "Beneficiari", url: "/beneficiari", icon: Users, group: "Sociale" },
  { title: "Interventi", url: "/interventi", icon: ClipboardList, group: "Sociale" },
  { title: "Consegne", url: "/consegne", icon: Truck, group: "Sociale" },
  { title: "Bolle", url: "/bolle", icon: FileText, group: "Sociale" },
  
  { title: "Volontari", url: "/volontari", icon: UsersRound, group: "Logistica" },
  { title: "Mezzi", url: "/mezzi", icon: Car, group: "Logistica" },
  { title: "Fornitori", url: "/fornitori", icon: Store, group: "Logistica" },
  { title: "Approvvigionamenti", url: "/approvvigionamenti", icon: ShoppingCart, group: "Logistica" },
  
  { title: "Report", url: "/report", icon: BarChart3, group: "Analisi" },
  { title: "Impostazioni Stampa", url: "/impostazioni-stampa", icon: Printer, group: "Analisi" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const groupedNav = NAV_ITEMS.reduce((acc, item) => {
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
        </Sidebar>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
