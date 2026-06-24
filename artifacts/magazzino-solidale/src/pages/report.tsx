import { useReportGiacenzePerMagazzino, useReportConsegnePerMese, useReportBeneficiariPerZona } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, LineChart, Line } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

export default function Report() {
  const currentYear = new Date().getFullYear();
  const { data: giacenze, isLoading: isLoadingGiacenze } = useReportGiacenzePerMagazzino();
  const { data: consegne, isLoading: isLoadingConsegne } = useReportConsegnePerMese({ anno: currentYear });
  const { data: beneficiari, isLoading: isLoadingBeneficiari } = useReportBeneficiariPerZona();

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analisi e Report</h1>
        <p className="text-muted-foreground">Dati aggregati sulle attività dell'associazione.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Consegne nell'Anno ({currentYear})</CardTitle>
            <CardDescription>Andamento mensile delle consegne effettuate vs mancate</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingConsegne ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={consegne} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mese" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="consegneEffettuate" name="Effettuate" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="consegneMancate" name="Mancate" stroke="hsl(var(--destructive))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prodotti Sottoscorta per Magazzino</CardTitle>
            <CardDescription>Confronto tra articoli totali e critici</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingGiacenze ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={giacenze} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="magazzinoNome" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <RechartsTooltip />
                    <Bar dataKey="totProdotti" name="Totale Articoli" fill="hsl(var(--primary) / 0.2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="prodottiSottoscorta" name="Sottoscorta" fill="hsl(var(--amber-500))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Distribuzione Beneficiari per Zona</CardTitle>
            <CardDescription>Concentrazione delle famiglie assistite e consegne a domicilio</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingBeneficiari ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={beneficiari} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="zona" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <RechartsTooltip />
                    <Bar dataKey="totBeneficiari" name="Totale Beneficiari" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="consegneDomicilio" name="Di cui a Domicilio" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
