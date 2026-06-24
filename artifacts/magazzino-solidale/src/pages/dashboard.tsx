import { useGetDashboardStats, useGetDashboardAlerts, useGetMovimentiRecenti } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Warehouse, Package, Users, Truck, AlertTriangle, Info, BellRing, Box, ArrowRightLeft, TrendingDown
} from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: alerts, isLoading: alertsLoading } = useGetDashboardAlerts();
  const { data: recenti, isLoading: recentiLoading } = useGetMovimentiRecenti();

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title={t("dashboard.statMagazzini")} 
          value={stats?.totMagazzini} 
          icon={Warehouse} 
          loading={statsLoading} 
        />
        <StatCard 
          title={t("dashboard.statProdotti")} 
          value={stats?.totProdotti} 
          icon={Package} 
          loading={statsLoading} 
        />
        <StatCard 
          title={t("dashboard.statBeneficiari")} 
          value={stats?.totBeneficiari} 
          icon={Users} 
          loading={statsLoading} 
        />
        <StatCard 
          title={t("dashboard.statVolontari")} 
          value={stats?.totVolontari} 
          icon={Users} 
          loading={statsLoading} 
        />
        <StatCard 
          title={t("dashboard.statConsegneOggi")} 
          value={stats?.consegneOggi} 
          icon={Truck} 
          loading={statsLoading} 
          description={t("dashboard.consegneMese", { count: stats?.consegneMese || 0 })}
        />
        <StatCard 
          title={t("dashboard.statLottiScadenza")} 
          value={stats?.lottiInScadenza} 
          icon={AlertTriangle} 
          loading={statsLoading} 
          alert={!!stats?.lottiInScadenza && stats.lottiInScadenza > 0}
        />
        <StatCard 
          title={t("dashboard.statProdottiSottoscorta")} 
          value={stats?.prodottiSottoscorta} 
          icon={TrendingDown} 
          loading={statsLoading}
          alert={!!stats?.prodottiSottoscorta && stats.prodottiSottoscorta > 0}
        />
        <StatCard 
          title={t("dashboard.statTrasferimenti")} 
          value={stats?.trasferimentiInCorso} 
          icon={ArrowRightLeft} 
          loading={statsLoading} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5" /> {t("dashboard.alertsTitle")}
            </CardTitle>
            <CardDescription>{t("dashboard.alertsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {alertsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : alerts && alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-start gap-3 p-3 rounded-md bg-muted/50 border">
                    <div className="mt-0.5">
                      {alert.livello === "danger" ? (
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                      ) : alert.livello === "warning" ? (
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                      ) : (
                        <Info className="h-5 w-5 text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{alert.messaggio}</p>
                      {alert.dettaglio && (
                        <p className="text-xs text-muted-foreground mt-1">{alert.dettaglio}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1 opacity-70">
                        {format(new Date(alert.data), "dd MMM yyyy, HH:mm", { locale: it })}
                      </p>
                    </div>
                    <Badge variant="outline" className={
                      alert.livello === "danger" ? "bg-destructive/10 text-destructive border-destructive/20" :
                      alert.livello === "warning" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                      "bg-blue-500/10 text-blue-600 border-blue-500/20"
                    }>
                      {alert.tipo}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Info className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">{t("dashboard.noAlerts")}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5" /> {t("dashboard.movimentiTitle")}
            </CardTitle>
            <CardDescription>{t("dashboard.movimentiDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {recentiLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recenti && recenti.length > 0 ? (
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-muted before:to-transparent hidden-before">
                {recenti.map((mov) => (
                  <div key={mov.id} className="relative flex items-center gap-4">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 bg-background z-10 shrink-0 ${mov.tipo === 'carico' ? 'border-green-500 text-green-500' : 'border-amber-500 text-amber-500'}`}>
                      {mov.tipo === 'carico' ? '+' : '-'}
                    </div>
                    <div className="flex-1 pb-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{mov.prodottoNome}</p>
                        <span className={`text-sm font-bold ${mov.tipo === 'carico' ? 'text-green-600' : 'text-amber-600'}`}>
                          {mov.tipo === 'carico' ? '+' : '-'}{mov.quantita} {mov.unitaMisura}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-muted-foreground">{mov.tipoDettaglio}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(mov.dataMovimento), "dd MMM", { locale: it })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ArrowRightLeft className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">{t("dashboard.noMovimenti")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  loading, 
  description,
  alert = false 
}: { 
  title: string; 
  value?: number; 
  icon: React.ElementType; 
  loading?: boolean;
  description?: string;
  alert?: boolean;
}) {
  return (
    <Card className={alert ? "border-amber-500/50 shadow-sm" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${alert ? "text-amber-500" : "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className={`text-2xl font-bold ${alert ? "text-amber-600" : ""}`}>
            {value !== undefined ? value : 0}
          </div>
        )}
        {description && (
          <p className="text-xs text-muted-foreground mt-1">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
