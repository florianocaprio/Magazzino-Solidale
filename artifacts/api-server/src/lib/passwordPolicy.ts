export const PASSWORD_POLICY_MESSAGE =
  "La password deve contenere almeno 8 caratteri, una lettera e un numero.";

/** Policy unica per password iniziali, cambio password e recupero. */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return PASSWORD_POLICY_MESSAGE;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}
