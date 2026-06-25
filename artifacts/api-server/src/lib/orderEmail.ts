// Uses the Replit Gmail connector (integration id: google-mail) via the
// connectors-sdk proxy. The SDK injects OAuth2 auth and refreshes tokens.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger.js";

export const AMMINISTRAZIONE_EMAIL = "amministrazione@angeliinmoto.it";
// Sending account connected via the Gmail connector.
const MITTENTE_EMAIL = "info@angeliinmoto.it";

const connectors = new ReplitConnectors();

function encodeMimeWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

// RFC 2045: base64 body lines must not exceed 76 chars; fold with CRLF.
function foldBase64(value: string): string {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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
 * Sends the procurement order email to amministrazione via the Gmail connector.
 * Builds an RFC 2822 message and posts it to the Gmail API messages.send endpoint
 * through the connectors proxy (handles OAuth2 token injection + refresh).
 * Throws on failure; the caller wraps this in try/catch so submission never fails.
 */
export async function sendApprovvigionamentoEmail(order: ApprovvigionamentoEmailData): Promise<void> {
  const { subject, text } = buildApprovvigionamentoEmail(order);

  const mime = [
    `From: ${MITTENTE_EMAIL}`,
    `To: ${AMMINISTRAZIONE_EMAIL}`,
    `Subject: ${encodeMimeWord(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    foldBase64(Buffer.from(text, "utf-8").toString("base64")),
  ].join("\r\n");

  const raw = toBase64Url(Buffer.from(mime, "utf-8"));

  const response = await connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger.error(
      { to: AMMINISTRAZIONE_EMAIL, subject, codice: order.codice, status: response.status, detail },
      "Invio email approvvigionamento fallito",
    );
    throw new Error(`Gmail send failed with status ${response.status}`);
  }

  logger.info(
    { to: AMMINISTRAZIONE_EMAIL, subject, codice: order.codice },
    "Email approvvigionamento inviata",
  );
}
