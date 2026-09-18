export type FseAttachPayload = {
  versione: number;
  versionePratica: number;
  rigaIds?: number[];
  idempotencyKey: string;
  confermaCoperturaStorica: boolean;
};

export type FseAttachIntent = {
  fingerprint: string;
  sessionId: number;
  practiceId: number;
  payload: FseAttachPayload;
};

type FseAttachIntentInput = {
  sessionId: number;
  practiceId: number;
  mode: "NUOVI_CARICHI" | "SALDO_INIZIALE";
  sessionVersion: number;
  practiceVersion: number;
  rowIds?: number[];
  historicalCoverageConfirmed: boolean;
};

export function resolveFseAttachIntent(
  current: FseAttachIntent | null,
  input: FseAttachIntentInput,
  createKey: () => string,
): FseAttachIntent {
  const rowIds =
    input.mode === "NUOVI_CARICHI"
      ? [...new Set(input.rowIds ?? [])].sort((left, right) => left - right)
      : undefined;
  const fingerprint = JSON.stringify({
    sessionId: input.sessionId,
    practiceId: input.practiceId,
    mode: input.mode,
    rowIds: rowIds ?? null,
    historicalCoverageConfirmed: input.historicalCoverageConfirmed,
  });
  if (current?.fingerprint === fingerprint) return current;
  return {
    fingerprint,
    sessionId: input.sessionId,
    practiceId: input.practiceId,
    payload: {
      versione: input.sessionVersion,
      versionePratica: input.practiceVersion,
      rigaIds: rowIds,
      idempotencyKey: createKey(),
      confermaCoperturaStorica: input.historicalCoverageConfirmed,
    },
  };
}

export function retainFseAttachIntentAfterError(error: unknown) {
  const name = (error as { name?: unknown })?.name;
  if (name === "ResponseParseError") return true;
  return name !== "ApiError";
}

export function reconcileFseReadySelection(
  current: ReadonlySet<number>,
  readyIds: number[],
  initialize: boolean,
) {
  const ready = new Set(readyIds);
  if (initialize) return ready;
  return new Set([...current].filter((id) => ready.has(id)));
}
