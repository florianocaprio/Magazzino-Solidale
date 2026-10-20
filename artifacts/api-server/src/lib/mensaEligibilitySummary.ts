type AbilitazioneStato = "attiva" | "sospesa" | "revocata" | "scaduta";

export type MensaRiepilogoStato =
  | AbilitazioneStato
  | "programmata"
  | "non_abilitato";
export type MensaRiepilogoHistoryRow = {
  id: number;
  dataInizio: string;
  dataFine: string | null;
  stato: AbilitazioneStato;
  mensaPrincipale: boolean;
};

export function riepilogoAbilitazioneMensa(
  records: readonly MensaRiepilogoHistoryRow[],
  today: string,
) {
  const current = records.find(
    (item) =>
      item.mensaPrincipale &&
      item.stato === "attiva" &&
      item.dataInizio <= today &&
      (item.dataFine == null || item.dataFine >= today),
  );
  const shown =
    current ??
    records.find((item) => item.mensaPrincipale) ??
    records[0] ??
    null;
  if (!shown) {
    return { stato: "non_abilitato" as const };
  }
  const stato: MensaRiepilogoStato =
    shown.stato === "attiva" && shown.dataInizio > today
      ? "programmata"
      : shown.stato === "attiva" &&
          shown.dataFine != null &&
          shown.dataFine < today
        ? "scaduta"
        : shown.stato;
  return { stato };
}
