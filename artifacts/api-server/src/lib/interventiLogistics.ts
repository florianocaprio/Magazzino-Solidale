/** Select the active request, not the last cancelled historical row. */
export function selectInterventoRaccordo<
  T extends { richiestaId: number; richiestaStato: string },
>(rows: T[]): (T & { ambiguo: boolean }) | null {
  const active = rows.filter(
    (row) => !["annullata", "chiusa"].includes(row.richiestaStato),
  );
  const row = active[0] ?? rows[0];
  return row ? { ...row, ambiguo: active.length > 1 } : null;
}
