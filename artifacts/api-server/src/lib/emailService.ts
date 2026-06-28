// Generic email service: sends via either the Replit Gmail connector
// (provider="connector", default) or a custom SMTP server (provider="smtp")
// using nodemailer. Settings live in the impostazioni_email singleton row.
// smtpPassword is write-only and never returned by the API.
import nodemailer from "nodemailer";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, impostazioniEmailTable, type ImpostazioniEmail } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const connectors = new ReplitConnectors();
const SINGLETON_ID = 1;

// Default sending account connected via the Gmail connector.
export const DEFAULT_MITTENTE_EMAIL = "info@angeliinmoto.it";
const DEFAULT_MITTENTE_NOME = "Magazzino Solidale AIM";

export interface EmailAttachment {
  filename: string;
  content: string; // utf-8 text content (e.g. ICS)
  contentType: string; // e.g. text/calendar; method=REQUEST; charset=UTF-8
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

function encodeMimeWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

// RFC 2045: base64 body lines must not exceed 76 chars; fold with CRLF.
function foldBase64(value: string): string {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Ensures the singleton settings row exists, returns it. */
export async function getEmailSettings(): Promise<ImpostazioniEmail> {
  await db.insert(impostazioniEmailTable).values({ id: SINGLETON_ID }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(impostazioniEmailTable)
    .where(eq(impostazioniEmailTable.id, SINGLETON_ID));
  return row;
}

function buildRawMime(opts: {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}): string {
  const headers = [
    `From: ${encodeMimeWord(opts.fromName)} <${opts.from}>`,
    `To: ${opts.to}`,
    `Subject: ${encodeMimeWord(opts.subject)}`,
    `MIME-Version: 1.0`,
  ];
  if (!opts.attachments?.length) {
    return [
      ...headers,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      foldBase64(Buffer.from(opts.text, "utf-8").toString("base64")),
    ].join("\r\n");
  }
  const boundary = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    foldBase64(Buffer.from(opts.text, "utf-8").toString("base64")),
  ];
  for (const att of opts.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      ``,
      foldBase64(Buffer.from(att.content, "utf-8").toString("base64")),
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join("\r\n");
}

async function sendViaConnector(settings: ImpostazioniEmail, input: SendEmailInput): Promise<void> {
  const from = settings.mittenteEmail?.trim() || DEFAULT_MITTENTE_EMAIL;
  const fromName = settings.mittenteNome?.trim() || DEFAULT_MITTENTE_NOME;
  const mime = buildRawMime({ from, fromName, to: input.to, subject: input.subject, text: input.text, attachments: input.attachments });
  const raw = toBase64Url(Buffer.from(mime, "utf-8"));
  const response = await connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger.error({ to: input.to, subject: input.subject, status: response.status, detail }, "Invio email (connettore) fallito");
    throw new Error(`Gmail connector send failed with status ${response.status}`);
  }
}

async function sendViaSmtp(settings: ImpostazioniEmail, input: SendEmailInput): Promise<void> {
  if (!settings.smtpHost?.trim()) {
    throw new Error("SMTP host non configurato");
  }
  const from = settings.mittenteEmail?.trim() || settings.smtpUser?.trim() || DEFAULT_MITTENTE_EMAIL;
  const fromName = settings.mittenteNome?.trim() || DEFAULT_MITTENTE_NOME;
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort ?? 587,
    secure: settings.smtpSecure,
    auth: settings.smtpUser?.trim()
      ? { user: settings.smtpUser, pass: settings.smtpPassword ?? "" }
      : undefined,
  });
  await transporter.sendMail({
    from: `${fromName} <${from}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}

/**
 * Sends an email using the configured provider. Throws on failure; callers that
 * must not fail (e.g. order submission) should wrap this in try/catch.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const settings = await getEmailSettings();
  if (settings.provider === "smtp") {
    await sendViaSmtp(settings, input);
  } else {
    await sendViaConnector(settings, input);
  }
  logger.info({ to: input.to, subject: input.subject, provider: settings.provider }, "Email inviata");
}
