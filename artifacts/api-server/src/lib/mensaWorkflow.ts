import { dataCivileEuropeRome } from "./interventiWorkflow";

/**
 * Business date used for Mensa eligibility, meals and stock expiry checks.
 * It is intentionally independent from the host/container timezone.
 */
export function dataServizioMensa(referenceDate = new Date()): string {
  return dataCivileEuropeRome(referenceDate);
}
