export function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { data?: { error?: string } })?.data?.error ??
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err as { message?: string })?.message ??
    fallback
  );
}
