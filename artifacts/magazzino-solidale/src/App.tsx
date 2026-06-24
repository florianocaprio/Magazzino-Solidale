import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Magazzini from "@/pages/magazzini";
import Prodotti from "@/pages/prodotti";
import Lotti from "@/pages/lotti";
import Giacenze from "@/pages/giacenze";
import Volontari from "@/pages/volontari";
import Mezzi from "@/pages/mezzi";
import Fornitori from "@/pages/fornitori";
import Trasferimenti from "@/pages/trasferimenti";
import Movimenti from "@/pages/movimenti";
import CentriAscolto from "@/pages/centri-ascolto";
import Beneficiari from "@/pages/beneficiari";
import BeneficiarioDettaglio from "@/pages/beneficiario-dettaglio";
import Interventi from "@/pages/interventi";
import Consegne from "@/pages/consegne";
import Bolle from "@/pages/bolle";
import Approvvigionamenti from "@/pages/approvvigionamenti";
import Report from "@/pages/report";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/magazzini" component={Magazzini} />
        <Route path="/prodotti" component={Prodotti} />
        <Route path="/lotti" component={Lotti} />
        <Route path="/movimenti" component={Movimenti} />
        <Route path="/giacenze" component={Giacenze} />
        <Route path="/trasferimenti" component={Trasferimenti} />
        
        <Route path="/centri-ascolto" component={CentriAscolto} />
        <Route path="/beneficiari" component={Beneficiari} />
        <Route path="/beneficiari/:id" component={BeneficiarioDettaglio} />
        <Route path="/interventi" component={Interventi} />
        <Route path="/consegne" component={Consegne} />
        <Route path="/bolle" component={Bolle} />
        
        <Route path="/volontari" component={Volontari} />
        <Route path="/mezzi" component={Mezzi} />
        <Route path="/fornitori" component={Fornitori} />
        <Route path="/approvvigionamenti" component={Approvvigionamenti} />
        
        <Route path="/report" component={Report} />
        
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
