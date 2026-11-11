export const sostieniProgettoConfig = {
  organizationName: "Angeli in Moto ODV",
  donationRecipientName: "Feliciangeli in Moto ODV",
  donationAddress: ["Via Gallia 86", "00183 Roma"],
  donationIban: "IT06Z0306905240100000000337",
  donationReason: "Donazione a sostegno del progetto Magazzino Solidale",
  paypalDonationUrl:
    "https://www.paypal.com/donate/?hosted_button_id=4BK4FMFSXW9E4",
  supportEmail: "supporto@angeliinmoto.it",
  logoUrl: "/logo-aim.png",
} as const;

const paypalReminderKey = "magazzino:paypal-reminder";
let paypalReminderWithoutStorage: { deadline: number | null | undefined } | undefined;

// undefined starts a new schedule, null suspends it for this login.
export function readPaypalReminderDeadline(): number | null | undefined {
  if (paypalReminderWithoutStorage) return paypalReminderWithoutStorage.deadline;
  try {
    const stored = sessionStorage.getItem(paypalReminderKey);
    if (stored === "opened") return null;
    const deadline = Number(stored);
    return Number.isFinite(deadline) && deadline > 0 ? deadline : undefined;
  } catch {
    return undefined;
  }
}

export function writePaypalReminderDeadline(deadline: number | null | undefined) {
  try {
    if (deadline === undefined) sessionStorage.removeItem(paypalReminderKey);
    else sessionStorage.setItem(paypalReminderKey, deadline === null ? "opened" : String(deadline));
    paypalReminderWithoutStorage = undefined;
  } catch {
    paypalReminderWithoutStorage = { deadline };
  }
}

export function buildSupportMailto(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
