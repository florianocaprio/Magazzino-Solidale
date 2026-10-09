/** Scanner codes are identifiers, not fuzzy search terms. */
export function scannedEmporioProduct<
  T extends { codice: string; codiceBarre?: string | null },
>(value: string, results: T[]) {
  const code = value.trim().toLocaleLowerCase();
  const exact = code
    ? results.filter((product) =>
        [product.codice, product.codiceBarre].some(
          (candidate) => candidate?.trim().toLocaleLowerCase() === code,
        ),
      )
    : [];
  return exact.length === 1
    ? { kind: "found" as const, product: exact[0] }
    : {
        kind: exact.length > 1 ? ("ambiguous" as const) : ("missing" as const),
      };
}

/** GET-only reconciliation: never repeats a command or fabricates a receipt. */
export async function readEmporioCheckoutOutcome<
  S extends {
    id: number;
    statoSessione: string;
    spesaEmporioId?: number | null;
  },
  P extends { id: number },
>(
  id: number,
  getSession: (id: number) => Promise<S>,
  getExpense: (id: number) => Promise<P>,
) {
  const session = await getSession(id);
  if (session.id !== id) throw new Error("Esito Sessione non coerente");
  if (session.statoSessione !== "chiusa")
    return { kind: "not_closed" as const, session };
  const expense = await getExpense(id);
  if (session.spesaEmporioId !== expense.id)
    throw new Error("Esito Spesa non coerente");
  return { kind: "closed" as const, session, expense };
}
