export type TrasferimentoDraftRiga = {
  prodottoId: string;
  quantita: string;
  unitaMisura: string;
};

export type TrasferimentoDraft = {
  note: string;
  righe: TrasferimentoDraftRiga[];
};

export function trasferimentoDraftIsDirty(
  initial: TrasferimentoDraft,
  current: TrasferimentoDraft,
): boolean {
  if (initial.note !== current.note) return true;
  if (initial.righe.length !== current.righe.length) return true;
  return initial.righe.some((riga, index) => {
    const corrente = current.righe[index];
    return (
      corrente == null ||
      riga.prodottoId !== corrente.prodottoId ||
      riga.quantita !== corrente.quantita ||
      riga.unitaMisura !== corrente.unitaMisura
    );
  });
}
