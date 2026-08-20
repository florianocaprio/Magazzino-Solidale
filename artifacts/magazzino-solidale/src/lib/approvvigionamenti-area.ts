export type FornitoreArea = { id: number; areaOperativaId?: number | null; attivo?: boolean };

export function fornitoriAttiviPerArea<T extends FornitoreArea>(fornitori: T[], areaOperativaId: number | undefined): T[] {
  if (areaOperativaId == null) return [];
  return fornitori.filter((fornitore) => fornitore.attivo === true && fornitore.areaOperativaId === areaOperativaId);
}
