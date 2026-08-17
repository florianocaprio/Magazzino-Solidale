import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import NotAuthorized from "@/pages/not-authorized";
import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Setup from "@/pages/setup";
import { AppLayout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useIdleLogout } from "@/lib/use-idle-logout";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useConfigurazioneAmbienteFlags } from "@/lib/use-moduli";

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
import ReportingLanding from "@/pages/reporting-landing";
import ReportingDashboardPage from "@/pages/reporting-dashboard";
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
import EmporioSpese from "@/pages/emporio-spese";
import UdsAnagrafica from "@/pages/uds-anagrafica";
import UdsInterventi from "@/pages/uds-interventi";
import UdsReportGiornaliero from "@/pages/uds-report-giornaliero";
import SuperAdminConfigurazioneAmbiente from "@/pages/super-admin-configurazione-ambiente";
import SuperAdminModuli from "@/pages/super-admin-moduli";
import SuperAdminAuditConfigurazioni from "@/pages/super-admin-audit-configurazioni";
import SuperAdminLogSistema from "@/pages/super-admin-log-sistema";
import SostieniProgetto from "@/pages/sostieni-progetto";
import MensaPage, { type MensaView } from "@/pages/mensa";

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

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.isSuperAdmin !== true) return <NotAuthorized />;
  return <>{children}</>;
}

export function RequireModulo({
  codice,
  children,
}: {
  codice: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  if (!isModuloAttivo(codice)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("superAdmin.moduleDisabled.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("superAdmin.moduleDisabled.description")}
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function RequireAnyModulo({
  codici,
  children,
}: {
  codici: readonly string[];
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { isAnyModuloAttivo } = useConfigurazioneAmbienteFlags();
  if (!isAnyModuloAttivo(codici)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("superAdmin.moduleDisabled.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("superAdmin.moduleDisabled.description")}
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function RequireAreaModulo({
  requisiti,
  children,
}: {
  requisiti: readonly { area: string; moduloCodice: string }[];
  children: React.ReactNode;
}) {
  const { hasArea } = useAuth();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  if (
    !requisiti.some(
      ({ area, moduloCodice }) =>
        hasArea(area) && isModuloAttivo(moduloCodice),
    )
  ) {
    return <NotAuthorized />;
  }
  return <>{children}</>;
}

function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) return <NotAuthorized />;
  return <>{children}</>;
}

function MensaRoute({ view, permission }: { view: MensaView; permission: string }) {
  return (
    <Guard area="mensa">
      <RequireModulo codice="MENSA">
        <RequirePermission permission={permission}>
          <MensaPage view={view} />
        </RequirePermission>
      </RequireModulo>
    </Guard>
  );
}

function ReportingRoute({
  section,
  areas,
  modules = [],
  anyModules = [],
  permission,
}: {
  section: React.ComponentProps<typeof ReportingDashboardPage>["section"];
  areas?: string[];
  modules?: string[];
  anyModules?: string[];
  permission?: string;
}) {
  const { hasArea, hasPermission } = useAuth();
  const { isModuloAttivo } = useConfigurazioneAmbienteFlags();
  if (areas && !areas.some(hasArea)) return <NotAuthorized />;
  if (permission && !hasPermission(permission)) return <NotAuthorized />;
  const disabledModule = modules.find((code) => !isModuloAttivo(code)) ??
    (anyModules.length > 0 && !anyModules.some(isModuloAttivo) ? anyModules[0] : undefined);
  if (disabledModule) return <RequireModulo codice={disabledModule}><ReportingDashboardPage section={section} /></RequireModulo>;
  return <ReportingDashboardPage section={section} />;
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
              <RequireModulo codice="LOTTI">
                <Lotti />
              </RequireModulo>
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
              <RequireModulo codice="TRASFERIMENTI">
                <Trasferimenti />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/preparazione-consegne">
          {() => (
            <Guard area="magazzino">
              <RequireModulo codice="MAGAZZINO_SOLIDALE">
                <PreparazioneConsegne />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/scarichi">
          {() => (
            <Guard area="magazzino">
              <RequireModulo codice="SCARICHI">
                <Scarichi />
              </RequireModulo>
            </Guard>
          )}
        </Route>

        <Route path="/emporio/cassa">
          {() => (
            <Guard area="emporio">
              <RequireModulo codice="EMPORIO_SOLIDALE">
                <EmporioCassa />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/emporio/crediti-saldo">
          {() => (
            <Guard area="emporio">
              <RequireModulo codice="EMPORIO_SOLIDALE">
                <RequireModulo codice="CREDITO_SOLIDALE">
                  <EmporioCreditiSaldo />
                </RequireModulo>
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/emporio/accessi">
          {() => (
            <Guard area="emporio">
              <RequireModulo codice="EMPORIO_SOLIDALE">
                <EmporioAccessi />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/emporio/spese">
          {() => (
            <Guard area="emporio">
              <RequireModulo codice="EMPORIO_SOLIDALE">
                <EmporioSpese />
              </RequireModulo>
            </Guard>
          )}
        </Route>

        <Route path="/centri-ascolto">
          {() => (
            <Guard area="amministrazione">
              <RequireAnyModulo
                codici={[
                  "CENTRO_ASCOLTO",
                  "EMPORIO_SOLIDALE",
                  "MENSA",
                  "CREDITO_SOLIDALE",
                ]}
              >
                <CentriAscolto />
              </RequireAnyModulo>
            </Guard>
          )}
        </Route>
        <Route path="/beneficiari">
          {() => (
            <Guard area="sociale">
              <RequireModulo codice="CENTRO_ASCOLTO">
                <Beneficiari />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/beneficiari/:id">
          {() => (
            <Guard area={["sociale", "uds"]}>
              <RequireAreaModulo
                requisiti={[
                  { area: "sociale", moduloCodice: "CENTRO_ASCOLTO" },
                  { area: "uds", moduloCodice: "UDS" },
                ]}
              >
                <BeneficiarioDettaglio />
              </RequireAreaModulo>
            </Guard>
          )}
        </Route>
        <Route path="/interventi">
          {() => (
            <Guard area="sociale">
              <RequireModulo codice="CENTRO_ASCOLTO">
                <Interventi />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/consegne">
          {() => (
            <Guard area="sociale">
              <RequireModulo codice="CENTRO_ASCOLTO">
                <RequireModulo codice="CONSEGNE">
                  <Consegne />
                </RequireModulo>
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/bolle">
          {() => (
            <Guard area="sociale">
              <RequireModulo codice="MAGAZZINO_SOLIDALE">
                <RequireModulo codice="BOLLE">
                  <Bolle />
                </RequireModulo>
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/turni">
          {() => (
            <Guard area="sociale">
              <RequireModulo codice="CENTRO_ASCOLTO">
                <Turni />
              </RequireModulo>
            </Guard>
          )}
        </Route>

        <Route path="/uds/anagrafica">
          {() => (
            <Guard area="uds">
              <RequireModulo codice="UDS">
                <UdsAnagrafica />
              </RequireModulo>
            </Guard>
          )}
        </Route>

        <Route path="/mensa/postazione">{() => <MensaRoute view="postazione" permission="mensa.access.scan" />}</Route>
        <Route path="/mensa/pasti">{() => <MensaRoute view="pasti" permission="mensa.view" />}</Route>
        <Route path="/mensa/abilitazioni">{() => <MensaRoute view="abilitazioni" permission="mensa.eligibility.manage" />}</Route>
        <Route path="/mensa/trasferimenti">{() => <MensaRoute view="trasferimenti" permission="mensa.transfers.manage" />}</Route>
        <Route path="/mensa/eccezioni">{() => <MensaRoute view="eccezioni" permission="mensa.view" />}</Route>
        <Route path="/mensa/report">{() => <MensaRoute view="report" permission="mensa.reports.view" />}</Route>
        <Route path="/uds/interventi">
          {() => (
            <Guard area="uds">
              <RequireModulo codice="UDS">
                <UdsInterventi />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/uds/report-giornaliero">
          {() => (
            <Guard area="uds">
              <RequireModulo codice="UDS">
                <UdsReportGiornaliero />
              </RequireModulo>
            </Guard>
          )}
        </Route>

        <Route path="/volontari">
          {() => (
            <Guard area="logistica">
              <RequireModulo codice="VOLONTARI">
                <Volontari />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/mezzi">
          {() => (
            <Guard area="logistica">
              <RequireModulo codice="MEZZI">
                <Mezzi />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/approvazioni-logistica">
          {() => (
            <Guard area="logistica">
              <RequireAnyModulo codici={["VOLONTARI", "MEZZI"]}>
                <ApprovazioniLogistica />
              </RequireAnyModulo>
            </Guard>
          )}
        </Route>
        <Route path="/fornitori">
          {() => (
            <Guard area="logistica">
              <RequireModulo codice="FORNITORI">
                <Fornitori />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/approvvigionamenti">
          {() => (
            <Guard area="logistica">
              <RequireModulo codice="APPROVVIGIONAMENTI">
                <Approvvigionamenti />
              </RequireModulo>
            </Guard>
          )}
        </Route>

        <Route path="/report/dashboard">
          {() => (
            <Guard area="analisi">
              <RequireModulo codice="REPORT">
                <ReportingRoute section="generale" />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/report/pacchi">
          {() => (
            <Guard area="analisi"><RequireModulo codice="REPORT"><ReportingRoute section="pacchi" areas={["sociale"]} modules={["MAGAZZINO_SOLIDALE", "BOLLE"]} /></RequireModulo></Guard>
          )}
        </Route>
        <Route path="/report/centro-ascolto">
          {() => (
            <Guard area="analisi"><RequireModulo codice="REPORT"><ReportingRoute section="centro-ascolto" areas={["sociale"]} modules={["CENTRO_ASCOLTO"]} /></RequireModulo></Guard>
          )}
        </Route>
        <Route path="/report/emporio">
          {() => (
            <Guard area="analisi"><RequireModulo codice="REPORT"><ReportingRoute section="emporio" areas={["emporio"]} modules={["EMPORIO_SOLIDALE"]} /></RequireModulo></Guard>
          )}
        </Route>
        <Route path="/report/mensa">
          {() => (
            <Guard area="analisi"><RequireModulo codice="REPORT"><ReportingRoute section="mensa" areas={["mensa"]} modules={["MENSA"]} permission="mensa.reports.view" /></RequireModulo></Guard>
          )}
        </Route>
        <Route path="/report/uds">
          {() => (
            <Guard area="analisi"><RequireModulo codice="REPORT"><ReportingRoute section="uds" areas={["uds"]} modules={["UDS"]} /></RequireModulo></Guard>
          )}
        </Route>
        <Route path="/report/magazzino-logistica">
          {() => (
            <Guard area="analisi"><RequireModulo codice="REPORT"><ReportingRoute section="magazzino-logistica" areas={["magazzino", "logistica"]} anyModules={["MAGAZZINO_SOLIDALE", "LOTTI", "TRASFERIMENTI", "MEZZI", "FORNITORI", "APPROVVIGIONAMENTI"]} /></RequireModulo></Guard>
          )}
        </Route>
        <Route path="/report/fse-plus">
          {() => (
            <Guard area="analisi"><RequireModulo codice="REPORT"><ReportingRoute section="fse-plus" /></RequireModulo></Guard>
          )}
        </Route>
        <Route path="/report">
          {() => (
            <Guard area="analisi">
              <RequireModulo codice="REPORT">
                <ReportingLanding />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/report-uds">
          {() => (
            <Guard area="analisi">
              <RequireModulo codice="REPORT"><ReportingRoute section="uds" areas={["uds"]} modules={["UDS"]} /></RequireModulo>
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
              <RequireModulo codice="UDS">
                <ZoneUds />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/ruoli-volontari">
          {() => (
            <Guard area="amministrazione">
              <RequireModulo codice="VOLONTARI">
                <RuoliVolontari />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/tipi-intervento">
          {() => (
            <Guard area="amministrazione">
              <RequireAnyModulo codici={["CENTRO_ASCOLTO", "UDS"]}>
                <TipiIntervento />
              </RequireAnyModulo>
            </Guard>
          )}
        </Route>
        <Route path="/tipologie-fornitore">
          {() => (
            <Guard area="amministrazione">
              <RequireModulo codice="FORNITORI">
                <TipologieFornitore />
              </RequireModulo>
            </Guard>
          )}
        </Route>
        <Route path="/politiche-credito-solidale">
          {() => (
            <Guard area="amministrazione">
              <RequireModulo codice="EMPORIO_SOLIDALE">
                <RequireModulo codice="CREDITO_SOLIDALE">
                  <PoliticheCreditoSolidale />
                </RequireModulo>
              </RequireModulo>
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
            <RequireSuperAdmin>
              <ImpostazioniModuli />
            </RequireSuperAdmin>
          )}
        </Route>

        <Route path="/super-admin/configurazione-ambiente">
          {() => (
            <RequireSuperAdmin>
              <SuperAdminConfigurazioneAmbiente />
            </RequireSuperAdmin>
          )}
        </Route>
        <Route path="/super-admin/moduli">
          {() => (
            <RequireSuperAdmin>
              <SuperAdminModuli />
            </RequireSuperAdmin>
          )}
        </Route>
        <Route path="/super-admin/audit-configurazioni">
          {() => (
            <RequireSuperAdmin>
              <SuperAdminAuditConfigurazioni />
            </RequireSuperAdmin>
          )}
        </Route>
        <Route path="/super-admin/log-sistema">
          {() => (
            <RequireSuperAdmin>
              <SuperAdminLogSistema />
            </RequireSuperAdmin>
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

        <Route path="/sostieni-progetto">{() => <SostieniProgetto />}</Route>

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function PublicAuthRoutes() {
  const [location] = useLocation();

  if (isPublicRoute(location, "/forgot-password")) return <ForgotPassword />;
  if (isPublicRoute(location, "/reset-password")) return <ResetPassword />;

  return (
    <Switch>
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/login" component={Login} />
      <Route component={Login} />
    </Switch>
  );
}

function isPublicRoute(location: string, path: string) {
  return location === path || location.startsWith(`${path}?`);
}

function AuthGate() {
  const { user, isLoading, bootstrap, bootstrapLoading, logout, refresh } =
    useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [location] = useLocation();

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

  if (
    isPublicRoute(location, "/forgot-password") ||
    isPublicRoute(location, "/reset-password")
  ) {
    return <PublicAuthRoutes />;
  }

  if (!user) {
    // First-run: no administrator exists yet. Anyone may create the system
    // users (one of which must be an admin) until an admin exists, after which
    // the app locks down to the normal login.
    if (bootstrap) return <Setup />;
    return <PublicAuthRoutes />;
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
