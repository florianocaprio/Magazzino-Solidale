import { dataCivileEuropeRome } from "./interventiWorkflow";

/**
 * Business date used for Mensa eligibility, meals and stock expiry checks.
 * It is intentionally independent from the host/container timezone.
 */
export function dataServizioMensa(referenceDate = new Date()): string {
  return dataCivileEuropeRome(referenceDate);
}

export function stessoGiornoServizioMensa(accesso: Date, pasto: Date): boolean {
  return dataServizioMensa(accesso) === dataServizioMensa(pasto);
}

/**
 * Territorial policy for exceptions between Mense.
 *
 * The current domain uses cittaId as its canonical territorial scope. Keeping
 * this comparison behind a semantic policy function avoids spreading that
 * implementation detail when a dedicated areaId is introduced in the future.
 */
export function canUseMensaException(
  principalTerritoryId: number | null,
  destinationTerritoryId: number | null,
): boolean {
  return (
    principalTerritoryId != null &&
    destinationTerritoryId != null &&
    principalTerritoryId === destinationTerritoryId
  );
}
