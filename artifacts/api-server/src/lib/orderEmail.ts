// Builds and sends the procurement order email via the shared email service
// (Gmail connector by default, or custom SMTP — configured in Impostazioni).
import { sendEmail, getEmailSettings } from "./emailService.js";

// Default recipient when no adminEmail is configured in Impostazioni Email.
export const AMMINISTRAZIONE_EMAIL = "amministrazione@angeliinmoto.it";

export interface ApprovvigionamentoEmailData {
  codice: string;
  fornitoreNome?: string | null;
  magazzinoNome?: string | null;
  centroAscoltoNome?: string | null;
  dataRichiesta: string;
  dataPrevista?: string | null;
  note?: string | null;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("it-IT");
}

export function buildApprovvigionamentoEmail(order: ApprovvigionamentoEmailData): {
  subject: string;
  text: string;
} {
  const subject = `Nuovo ordine di approvvigionamento ${order.codice}`;
  const lines = [
    `È stato sottomesso un nuovo ordine di approvvigionamento.`,
    ``,
    `Codice ordine: ${order.codice}`,
    `Fornitore / Donatore: ${order.fornitoreNome || "Non specificato"}`,
    `Magazzino: ${order.magazzinoNome || "Non specificato"}`,
    `Centro di Ascolto: ${order.centroAscoltoNome || "Non specificato"}`,
    `Data richiesta: ${formatDate(order.dataRichiesta)}`,
    `Data prevista consegna: ${formatDate(order.dataPrevista)}`,
    ``,
    `Materiale richiesto / Note:`,
    order.note?.trim() ? order.note : "(nessuna nota inserita)",
    ``,
    `--`,
    `Magazzino Solidale AIM`,
  ];
  return { subject, text: lines.join("\n") };
}

/**
 * Sends the procurement order email to amministrazione via the configured
 * provider (Gmail connector by default, or custom SMTP). Recipient is the
 * adminEmail from Impostazioni Email, falling back to AMMINISTRAZIONE_EMAIL.
 * Throws on failure; callers wrap this in try/catch when submission must not fail.
 */
export async function sendApprovvigionamentoEmail(order: ApprovvigionamentoEmailData): Promise<void> {
  const { subject, text } = buildApprovvigionamentoEmail(order);
  const settings = await getEmailSettings();
  const to = settings.adminEmail?.trim() || AMMINISTRAZIONE_EMAIL;
  await sendEmail({ to, subject, text });
}
