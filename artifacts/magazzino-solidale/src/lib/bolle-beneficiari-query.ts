/** Una Bolla M5B collegata non richiede la directory per mostrare il destinatario. */
export function shouldFetchBollaBeneficiari(
  canViewDirectory: boolean,
  linkedRequest: boolean | null,
): boolean {
  // null indica un collegamento non ancora risolto: non equivale a Bolla libera.
  return canViewDirectory && linkedRequest === false;
}
