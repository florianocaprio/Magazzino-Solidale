import { MENSA_REQUEST_READ_PERMISSIONS } from "./mensa-request-access";

/** Match the source capabilities of the logistics report, without granting them. */
export function hasLogisticsReportSource(
  area: (key: string) => boolean,
  grant: (key: string) => boolean,
  active: (code: string) => boolean,
): boolean {
  if (!active("REPORT") || (!area("magazzino") && !area("logistica")))
    return false;
  const stock = area("magazzino") && grant("magazzino.view");
  const requests =
    (area("magazzino") && grant("richieste_magazzino.view")) ||
    (area("mensa") && MENSA_REQUEST_READ_PERMISSIONS.some(grant));
  return (
    (stock &&
      (active("MAGAZZINO_SOLIDALE") ||
        active("LOTTI") ||
        active("TRASFERIMENTI"))) ||
    (requests && active("MAGAZZINO_SOLIDALE")) ||
    (area("logistica") &&
      active("LOGISTICA") &&
      [
        ["approvvigionamenti.view", "APPROVVIGIONAMENTI"],
        ["logistica.mezzi.view", "MEZZI"],
        ["logistica.volontari.view", "VOLONTARI"],
      ].some(([permission, code]) => grant(permission) && active(code)))
  );
}
