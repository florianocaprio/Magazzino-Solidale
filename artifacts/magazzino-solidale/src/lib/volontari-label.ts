export type VolontarioLabelInput = {
  nome?: string | null;
  cognome?: string | null;
  matricola?: string | null;
  centroAscoltoNome?: string | null;
};

export function volontarioLabel(v: VolontarioLabelInput): string {
  const nome = [v.nome, v.cognome].map((part) => part?.trim()).filter(Boolean).join(" ");
  const matricola = v.matricola?.trim();
  const centro = v.centroAscoltoNome?.trim();
  return [nome, matricola, centro].filter(Boolean).join(" — ");
}
