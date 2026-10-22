/** Product capabilities, not new infrastructure. Persisted choices are retained;
 * unavailable/future components never become an authorization grant. */
export const UNAVAILABLE_MODULES = new Set(["PREDITTIVO", "REPORT_AVANZATI"]);
export const MODULE_DEPENDENCIES: Record<string, readonly string[]> = {
  CARICHI: ["LOTTI"],
  // Credit history remains readable independently; new operations enforce
  // the Emporio service gate in their specialist handlers.
};
