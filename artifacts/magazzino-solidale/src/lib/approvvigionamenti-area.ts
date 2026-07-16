export type FornitoreArea = { id: number; cittaId?: number | null; attivo?: boolean };

export function fornitoriAttiviPerArea<T extends FornitoreArea>(fornitori: T[], cittaId: number | undefined): T[] {
  if (cittaId == null) return [];
  return fornitori.filter((fornitore) => fornitore.attivo === true && fornitore.cittaId === cittaId);
}
