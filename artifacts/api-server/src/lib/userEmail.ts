const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUserEmail(value: string): boolean {
  return EMAIL_RE.test(normalizeEmail(value));
}
