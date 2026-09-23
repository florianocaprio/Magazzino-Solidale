export type TrasferimentoDraftRiga = {
  prodottoId: string;
  quantita: string;
  unitaMisura: string;
  lottoId: string;
};

export type TrasferimentoDraft = {
  note: string;
  righe: TrasferimentoDraftRiga[];
};

export function transferRowsHaveRequiredLots(
  rows: TrasferimentoDraftRiga[],
  products: Array<{ id: number; lottoFisicoObbligatorio: boolean }> | undefined,
): boolean {
  return (
    !!products &&
    rows.every((row) => {
      const product = products.find(
        (candidate) => candidate.id === Number(row.prodottoId),
      );
      return (
        product != null && (!product.lottoFisicoObbligatorio || !!row.lottoId)
      );
    })
  );
}

export function transferRowsForPayload(rows: TrasferimentoDraftRiga[]) {
  return rows.map((row) => ({
    prodottoId: Number(row.prodottoId),
    lottoId: row.lottoId ? Number(row.lottoId) : undefined,
    quantita: row.quantita,
    unitaMisura: row.unitaMisura,
  }));
}

export function transferLotIsAvailable(
  lotto: {
    prodottoId: number;
    magazzinoId: number;
    disponibileReale: number;
    dataScadenza?: string | null;
  },
  prodottoId: number,
  magazzinoId: number,
  dataOperativa: string,
): boolean {
  return (
    lotto.prodottoId === prodottoId &&
    lotto.magazzinoId === magazzinoId &&
    lotto.disponibileReale > 0 &&
    (lotto.dataScadenza == null || lotto.dataScadenza >= dataOperativa)
  );
}

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
      riga.unitaMisura !== corrente.unitaMisura ||
      riga.lottoId !== corrente.lottoId
    );
  });
}
