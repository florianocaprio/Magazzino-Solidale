import { logger } from "./logger.js";

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
 * Sends the procurement order email to amministrazione.
 * NOTE: actual delivery is wired to the Gmail integration in a follow-up step.
 * Until then this is a no-op that logs the composed message so submission never fails.
 */
export async function sendApprovvigionamentoEmail(order: ApprovvigionamentoEmailData): Promise<void> {
  const { subject } = buildApprovvigionamentoEmail(order);
  logger.warn(
    { to: AMMINISTRAZIONE_EMAIL, subject, codice: order.codice },
    "Email approvvigionamento non ancora inviata: integrazione Gmail non configurata",
  );
}
