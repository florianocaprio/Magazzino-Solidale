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
