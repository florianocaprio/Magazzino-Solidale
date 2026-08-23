import ReportingDashboardPage from "@/pages/reporting-dashboard";

/**
 * La dashboard iniziale usa lo stesso builder autorevole di /report/dashboard.
 * In questo modo KPI, tabelle, drill-down ed export non mantengono calcoli paralleli.
 */
export default function Dashboard() {
  return <ReportingDashboardPage section="generale" />;
}
