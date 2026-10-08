export function mensaErrorMessage(
  error: unknown,
  fallback = "Operazione non riuscita",
): string {
  const value = error as {
    data?: { error?: unknown };
    response?: { data?: { error?: unknown } };
    message?: unknown;
  } | null;
  for (const candidate of [
    value?.data?.error,
    value?.response?.data?.error,
    value?.message,
  ])
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  return fallback;
}
