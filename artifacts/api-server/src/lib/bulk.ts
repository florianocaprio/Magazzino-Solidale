export type BulkRowResult = { ok: true } | { error: string };

export type BulkImportResult = {
  creati: number;
  errori: { riga: number; messaggio: string }[];
};

/**
 * Runs a per-row create function over an array of rows, collecting successes and
 * per-row errors instead of failing the whole batch. `riga` is the 1-based index
 * within the submitted array (the caller maps it back to the spreadsheet row).
 * Rows are processed sequentially to keep timestamp-based codes unique and to
 * avoid hammering the DB with parallel inserts.
 */
export async function runBulk<T>(
  righe: T[],
  createOne: (row: T) => Promise<BulkRowResult>,
): Promise<BulkImportResult> {
  let creati = 0;
  const errori: { riga: number; messaggio: string }[] = [];
  for (let i = 0; i < righe.length; i++) {
    try {
      const r = await createOne(righe[i]);
      if ("error" in r) errori.push({ riga: i + 1, messaggio: r.error });
      else creati++;
    } catch (e) {
      errori.push({ riga: i + 1, messaggio: e instanceof Error ? e.message : "Errore sconosciuto" });
    }
  }
  return { creati, errori };
}
