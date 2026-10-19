export type MensaPostCreateResult<TBeneficiario> = {
  beneficiario: TBeneficiario;
  mensaAbilitata: boolean;
  mensaError?: unknown;
};

/**
 * Mantiene intenzionalmente separate le due operazioni: se l'abilitazione
 * Mensa fallisce, il beneficiario già creato non viene perso né ricreato.
 */
export async function createBeneficiarioWithOptionalMensa<
  TBeneficiario extends { id: number },
>(options: {
  createBeneficiario: () => Promise<TBeneficiario>;
  createMensaAbilitazione?: (beneficiarioId: number) => Promise<unknown>;
}): Promise<MensaPostCreateResult<TBeneficiario>> {
  const beneficiario = await options.createBeneficiario();
  if (!options.createMensaAbilitazione) {
    return { beneficiario, mensaAbilitata: false };
  }

  try {
    await options.createMensaAbilitazione(beneficiario.id);
    return { beneficiario, mensaAbilitata: true };
  } catch (mensaError) {
    return { beneficiario, mensaAbilitata: false, mensaError };
  }
}


export type BeneficiarioServicesResult<T> = MensaPostCreateResult<T> & {
  emporioAbilitato: boolean;
  emporioError?: unknown;
};

/** I retry riprendono la stessa persona e soltanto le abilitazioni incomplete. */
export async function createBeneficiarioWithOptionalServices<T extends { id: number }>(options: {
  createBeneficiario: () => Promise<T>;
  previous?: BeneficiarioServicesResult<T> | null;
  createMensaAbilitazione?: (id: number) => Promise<unknown>;
  createEmporioAbilitazione?: (id: number) => Promise<unknown>;
}): Promise<BeneficiarioServicesResult<T>> {
  const mensa = await createBeneficiarioWithOptionalMensa({
    createBeneficiario: options.previous ? async () => options.previous!.beneficiario : options.createBeneficiario,
    createMensaAbilitazione: options.previous?.mensaAbilitata ? undefined : options.createMensaAbilitazione,
  });
  const result: BeneficiarioServicesResult<T> = {
    ...mensa,
    mensaAbilitata: options.previous?.mensaAbilitata || mensa.mensaAbilitata,
    emporioAbilitato: options.previous?.emporioAbilitato ?? false,
  };
  if (options.createEmporioAbilitazione && !result.emporioAbilitato) {
    try { await options.createEmporioAbilitazione(result.beneficiario.id); result.emporioAbilitato = true; }
    catch (error) { result.emporioError = error; }
  }
  return result;
}
