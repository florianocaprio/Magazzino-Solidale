import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import NotAuthorized from "@/pages/not-authorized";
import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import Setup from "@/pages/setup";
import { AppLayout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useIdleLogout } from "@/lib/use-idle-logout";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_KEEPALIVE_MS = 5 * 60 * 1000;

import Dashboard from "@/pages/dashboard";
import Magazzini from "@/pages/magazzini";
import Prodotti from "@/pages/prodotti";
import Lotti from "@/pages/lotti";
import Giacenze from "@/pages/giacenze";
import PreparazioneConsegne from "@/pages/preparazione-consegne";
import Volontari from "@/pages/volontari";
import Mezzi from "@/pages/mezzi";
import ApprovazioniLogistica from "@/pages/approvazioni-logistica";
import Fornitori from "@/pages/fornitori";
import Trasferimenti from "@/pages/trasferimenti";
import Scarichi from "@/pages/scarichi";
import Movimenti from "@/pages/movimenti";
import CentriAscolto from "@/pages/centri-ascolto";
import Beneficiari from "@/pages/beneficiari";
import BeneficiarioDettaglio from "@/pages/beneficiario-dettaglio";
import Interventi from "@/pages/interventi";
import Consegne from "@/pages/consegne";
import Bolle from "@/pages/bolle";
import Turni from "@/pages/turni";
import ImpostazioniStampa from "@/pages/impostazioni-stampa";
import ImpostazioniModuli from "@/pages/impostazioni-moduli";
import Approvvigionamenti from "@/pages/approvvigionamenti";
import Report from "@/pages/report";
import ReportUds from "@/pages/report-uds";
import Utenti from "@/pages/utenti";
import Ruoli from "@/pages/ruoli";
import Citta from "@/pages/citta";
import ZoneUds from "@/pages/zone-uds";
import RuoliVolontari from "@/pages/ruoli-volontari";
import TipiIntervento from "@/pages/tipi-intervento";
import TipologieFornitore from "@/pages/tipologie-fornitore";
import PoliticheCreditoSolidale from "@/pages/politiche-credito-solidale";
import EmporioCassa from "@/pages/emporio-cassa";
import EmporioCreditiSaldo from "@/pages/emporio-crediti-saldo";
import EmporioAccessi from "@/pages/emporio-accessi";
import UdsAnagrafica from "@/pages/uds-anagrafica";
import UdsInterventi from "@/pages/uds-interventi";
import UdsReportGiornaliero from "@/pages/uds-report-giornaliero";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Guard({
  area,
  children,
}: {
  area: string | string[];
  children: React.ReactNode;
}) {
  const { hasArea } = useAuth();
  const areas = Array.isArray(area) ? area : [area];
  if (!areas.some((a) => hasArea(a))) return <NotAuthorized />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/">
          {() => (
            <Guard area="generale">
              <Dashboard />
            </Guard>
          )}
        </Route>

        <Route path="/magazzini">
          {() => (
            <Guard area="amministrazione">
              <Magazzini />
            </Guard>
          )}
        </Route>
        <Route path="/prodotti">
          {() => (
            <Guard area="magazzino">
              <Prodotti />
            </Guard>
          )}
        </Route>
        <Route path="/lotti">
          {() => (
            <Guard area="magazzino">
              <Lotti />
            </Guard>
          )}
        </Route>
        <Route path="/movimenti">
          {() => (
            <Guard area="magazzino">
              <Movimenti />
            </Guard>
          )}
        </Route>
        <Route path="/giacenze">
          {() => (
            <Guard area="magazzino">
              <Giacenze />
            </Guard>
          )}
        </Route>
        <Route path="/trasferimenti">
          {() => (
            <Guard area="magazzino">
              <Trasferimenti />
            </Guard>
          )}
        </Route>
        <Route path="/preparazione-consegne">
          {() => (
            <Guard area="magazzino">
              <PreparazioneConsegne />
            </Guard>
          )}
        </Route>
        <Route path="/scarichi">
          {() => (
            <Guard area="magazzino">
              <Scarichi />
            </Guard>
          )}
        </Route>

        <Route path="/emporio/cassa">
          {() => (
            <Guard area="sociale">
              <EmporioCassa />
            </Guard>
          )}
        </Route>
        <Route path="/emporio/crediti-saldo">
          {() => (
            <Guard area="sociale">
              <EmporioCreditiSaldo />
            </Guard>
          )}
        </Route>
        <Route path="/emporio/accessi">
          {() => (
            <Guard area="sociale">
              <EmporioAccessi />
            </Guard>
          )}
        </Route>

        <Route path="/centri-ascolto">
          {() => (
            <Guard area="amministrazione">
              <CentriAscolto />
            </Guard>
          )}
        </Route>
        <Route path="/beneficiari">
          {() => (
            <Guard area="sociale">
              <Beneficiari />
            </Guard>
          )}
        </Route>
        <Route path="/beneficiari/:id">
          {() => (
            <Guard area={["sociale", "uds"]}>
              <BeneficiarioDettaglio />
            </Guard>
          )}
        </Route>
        <Route path="/interventi">
          {() => (
            <Guard area="sociale">
              <Interventi />
            </Guard>
          )}
        </Route>
        <Route path="/consegne">
          {() => (
            <Guard area="sociale">
              <Consegne />
            </Guard>
          )}
        </Route>
        <Route path="/bolle">
          {() => (
            <Guard area="sociale">
              <Bolle />
            </Guard>
          )}
        </Route>
        <Route path="/turni">
          {() => (
            <Guard area="sociale">
              <Turni />
            </Guard>
          )}
        </Route>

        <Route path="/uds/anagrafica">
          {() => (
            <Guard area="uds">
              <UdsAnagrafica />
            </Guard>
          )}
        </Route>
        <Route path="/uds/interventi">
          {() => (
            <Guard area="uds">
              <UdsInterventi />
            </Guard>
          )}
        </Route>
        <Route path="/uds/report-giornaliero">
          {() => (
            <Guard area="uds">
              <UdsReportGiornaliero />
            </Guard>
          )}
        </Route>

        <Route path="/volontari">
          {() => (
            <Guard area="logistica">
              <Volontari />
            </Guard>
          )}
        </Route>
        <Route path="/mezzi">
          {() => (
            <Guard area="logistica">
              <Mezzi />
            </Guard>
          )}
        </Route>
        <Route path="/approvazioni-logistica">
          {() => (
            <Guard area="logistica">
              <ApprovazioniLogistica />
            </Guard>
          )}
        </Route>
        <Route path="/fornitori">
          {() => (
            <Guard area="logistica">
              <Fornitori />
            </Guard>
          )}
        </Route>
        <Route path="/approvvigionamenti">
          {() => (
            <Guard area="logistica">
              <Approvvigionamenti />
            </Guard>
          )}
        </Route>

        <Route path="/report">
          {() => (
            <Guard area="analisi">
              <Report />
            </Guard>
          )}
        </Route>
        <Route path="/report-uds">
          {() => (
            <Guard area="analisi">
              <ReportUds />
            </Guard>
          )}
        </Route>
        <Route path="/citta">
          {() => (
            <Guard area="amministrazione">
              <Citta />
            </Guard>
          )}
        </Route>
        <Route path="/zone-uds">
          {() => (
            <Guard area="amministrazione">
              <ZoneUds />
            </Guard>
          )}
        </Route>
        <Route path="/ruoli-volontari">
          {() => (
            <Guard area="amministrazione">
              <RuoliVolontari />
            </Guard>
          )}
        </Route>
        <Route path="/tipi-intervento">
          {() => (
            <Guard area="amministrazione">
              <TipiIntervento />
            </Guard>
          )}
        </Route>
        <Route path="/tipologie-fornitore">
          {() => (
            <Guard area="amministrazione">
              <TipologieFornitore />
            </Guard>
          )}
        </Route>
        <Route path="/politiche-credito-solidale">
          {() => (
            <Guard area="amministrazione">
              <PoliticheCreditoSolidale />
            </Guard>
          )}
        </Route>
        <Route path="/impostazioni-stampa">
          {() => (
            <Guard area="amministrazione">
              <ImpostazioniStampa />
            </Guard>
          )}
        </Route>
        <Route path="/impostazioni-moduli">
          {() => (
            <Guard area="amministrazione">
              <ImpostazioniModuli />
            </Guard>
          )}
        </Route>

        <Route path="/utenti">
          {() => (
            <Guard area="amministrazione">
              <Utenti />
            </Guard>
          )}
        </Route>
        <Route path="/ruoli">
          {() => (
            <Guard area="amministrazione">
              <Ruoli />
            </Guard>
          )}
        </Route>

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function AuthGate() {
  const { user, isLoading, bootstrap, bootstrapLoading, logout, refresh } =
    useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  useIdleLogout({
    enabled: !!user,
    timeoutMs: IDLE_TIMEOUT_MS,
    keepAliveMs: IDLE_KEEPALIVE_MS,
    onKeepAlive: refresh,
    onIdle: () => {
      logout();
      toast({
        title: t("common.sessionExpired"),
        description: t("common.sessionExpiredDesc"),
        variant: "destructive",
      });
    },
  });

  if (isLoading || bootstrapLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    // First-run: no administrator exists yet. Anyone may create the system
    // users (one of which must be an admin) until an admin exists, after which
    // the app locks down to the normal login.
    if (bootstrap) return <Setup />;
    return <Login />;
  }
  if (user.mustChangePassword) return <ChangePassword />;

  return <AppRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
