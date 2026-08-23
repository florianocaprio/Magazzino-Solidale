import ReportingDashboardPage from "@/pages/reporting-dashboard";

/** Compatibilità legacy: usa il builder integrato senza mantenere calcoli paralleli. */
export default function Report() {
  return <ReportingDashboardPage section="magazzino-logistica" />;
}
