import nodemailer from "nodemailer";
import type { ImpostazioniEmail } from "@workspace/db";
import { logger } from "./logger.js";

const SINGLETON_ID = 1;

export const DEFAULT_MAIL_FROM = '"Magazzino Solidale" <info@angeliinmoto.it>';
export const DEFAULT_PASSWORD_RESET_TOKEN_TTL_MINUTES = 60;

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  sent: boolean;
  mode: "smtp" | "disabled";
  messageId?: string | null;
}

export interface PasswordResetEmailParams {
  to: string;
  nome?: string | null;
  username?: string | null;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface PasswordChangedEmailParams {
  to: string;
  nome?: string | null;
  username?: string | null;
}

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
};

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = readEnv(name);
  if (!value) return defaultValue;
  if (["true", "1", "yes", "y", "si", "s"].includes(value.toLowerCase()))
    return true;
  if (["false", "0", "no", "n"].includes(value.toLowerCase())) return false;
  throw new EmailConfigurationError(`${name} deve essere true oppure false`);
}

function parsePort(value: string | undefined, secure: boolean): number {
  if (!value) return secure ? 465 : 587;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new EmailConfigurationError("MAIL_PORT non valido");
  }
  return parsed;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function hasMailEnv(): boolean {
  return [
    "MAIL_PROVIDER",
    "MAIL_HOST",
    "MAIL_PORT",
    "MAIL_SECURE",
    "MAIL_USER",
    "MAIL_PASSWORD",
    "MAIL_FROM",
    "MAIL_REPLY_TO",
  ].some((name) => readEnv(name) != null);
}

function resolveSmtpConfigFromEnv(): SmtpConfig | null {
  const provider = readEnv("MAIL_PROVIDER")?.toLowerCase();
  if (provider && provider !== "smtp") {
    throw new EmailConfigurationError(
      "MAIL_PROVIDER supporta solo il valore smtp",
    );
  }
  if (!provider && !hasMailEnv()) return null;

  const host = readEnv("MAIL_HOST");
  if (!host) throw new EmailConfigurationError("MAIL_HOST non configurato");

  const secure = parseBooleanEnv("MAIL_SECURE", false);
  const user = readEnv("MAIL_USER");
  const password = readEnv("MAIL_PASSWORD");
  if (user && !password) {
    throw new EmailConfigurationError(
      "MAIL_PASSWORD mancante per MAIL_USER configurato",
    );
  }

  return {
    host,
    port: parsePort(readEnv("MAIL_PORT"), secure),
    secure,
    user,
    password,
    from: readEnv("MAIL_FROM") ?? user ?? DEFAULT_MAIL_FROM,
    replyTo: readEnv("MAIL_REPLY_TO"),
  };
}

function resolveTransportConfig():
  | { mode: "smtp"; smtp: SmtpConfig }
  | { mode: "disabled" } {
  const smtp = resolveSmtpConfigFromEnv();
  if (smtp) return { mode: "smtp", smtp };
  if (isProduction()) {
    throw new EmailConfigurationError(
      "Configurazione SMTP mancante: impostare MAIL_PROVIDER=smtp, MAIL_HOST e MAIL_FROM",
    );
  }
  return { mode: "disabled" };
}

function assertNonEmpty(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} obbligatorio`);
  return trimmed;
}

function displayName(params: {
  nome?: string | null;
  username?: string | null;
}): string {
  return params.nome?.trim() || params.username?.trim() || "utente";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMinutes(value: number): string {
  return value === 1 ? "1 minuto" : `${value} minuti`;
}

export function getAppBaseUrl(): string {
  return (readEnv("APP_BASE_URL") ?? "http://localhost:8080").replace(
    /\/+$/,
    "",
  );
}

export function getPasswordResetTokenTtlMinutes(): number {
  const raw = readEnv("PASSWORD_RESET_TOKEN_TTL_MINUTES");
  if (!raw) return DEFAULT_PASSWORD_RESET_TOKEN_TTL_MINUTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn(
      { value: raw },
      "PASSWORD_RESET_TOKEN_TTL_MINUTES non valido: uso default sicuro",
    );
    return DEFAULT_PASSWORD_RESET_TOKEN_TTL_MINUTES;
  }
  return parsed;
}

/**
 * Legacy helper retained for existing order-email recipient settings.
 * Transport credentials are resolved from MAIL_* environment variables.
 */
export async function getEmailSettings(): Promise<ImpostazioniEmail> {
  const [{ db, impostazioniEmailTable }, { eq }] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
  ]);
  await db
    .insert(impostazioniEmailTable)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(impostazioniEmailTable)
    .where(eq(impostazioniEmailTable.id, SINGLETON_ID));
  return row;
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const to = assertNonEmpty(input.to, "Destinatario email");
  const subject = assertNonEmpty(input.subject, "Oggetto email");
  const text = assertNonEmpty(input.text, "Testo email");
  const transport = resolveTransportConfig();

  if (transport.mode === "disabled") {
    logger.info(
      { to, subject, mode: "disabled" },
      "Email non inviata: SMTP non configurato in ambiente non production",
    );
    return { sent: false, mode: "disabled" };
  }

  const transporter = nodemailer.createTransport({
    host: transport.smtp.host,
    port: transport.smtp.port,
    secure: transport.smtp.secure,
    auth: transport.smtp.user
      ? { user: transport.smtp.user, pass: transport.smtp.password ?? "" }
      : undefined,
  });
  const info = await transporter.sendMail({
    from: transport.smtp.from,
    to,
    subject,
    text,
    html: input.html,
    replyTo: input.replyTo ?? transport.smtp.replyTo,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });

  logger.info({ to, subject, mode: "smtp" }, "Email inviata");
  return { sent: true, mode: "smtp", messageId: info.messageId ?? null };
}

export function buildPasswordResetEmail(
  params: PasswordResetEmailParams,
): Pick<SendEmailInput, "subject" | "text" | "html"> {
  const name = displayName(params);
  const expiry = formatMinutes(params.expiresInMinutes);
  const subject = "Recupero password Magazzino Solidale";
  const text = [
    `Ciao ${name},`,
    "",
    "abbiamo ricevuto una richiesta di recupero password per il tuo account Magazzino Solidale.",
    "Per impostare una nuova password apri questo link:",
    params.resetUrl,
    "",
    `Il link scade tra ${expiry}.`,
    "",
    "Se non hai richiesto tu il recupero password, ignora questa email o contatta l'amministratore.",
    "",
    "Magazzino Solidale",
  ].join("\n");
  const safeName = escapeHtml(name);
  const safeResetUrl = escapeHtml(params.resetUrl);
  const safeExpiry = escapeHtml(expiry);
  const html = [
    `<p>Ciao ${safeName},</p>`,
    `<p>abbiamo ricevuto una richiesta di recupero password per il tuo account <strong>Magazzino Solidale</strong>.</p>`,
    `<p><a href="${safeResetUrl}">Imposta una nuova password</a></p>`,
    `<p>Il link scade tra ${safeExpiry}.</p>`,
    `<p>Se non hai richiesto tu il recupero password, ignora questa email o contatta l'amministratore.</p>`,
    `<p>Magazzino Solidale</p>`,
  ].join("");
  return { subject, text, html };
}

export function buildPasswordChangedEmail(
  params: PasswordChangedEmailParams,
): Pick<SendEmailInput, "subject" | "text" | "html"> {
  const name = displayName(params);
  const subject = "Password modificata - Magazzino Solidale";
  const text = [
    `Ciao ${name},`,
    "",
    "la password del tuo account Magazzino Solidale è stata modificata correttamente.",
    "",
    "Se non hai effettuato tu questa operazione, contatta subito l'amministratore.",
    "",
    "Magazzino Solidale",
  ].join("\n");
  const safeName = escapeHtml(name);
  const html = [
    `<p>Ciao ${safeName},</p>`,
    `<p>la password del tuo account <strong>Magazzino Solidale</strong> è stata modificata correttamente.</p>`,
    `<p>Se non hai effettuato tu questa operazione, contatta subito l'amministratore.</p>`,
    `<p>Magazzino Solidale</p>`,
  ].join("");
  return { subject, text, html };
}

export async function sendPasswordResetEmail(
  params: PasswordResetEmailParams,
): Promise<SendEmailResult> {
  const message = buildPasswordResetEmail(params);
  return sendEmail({ to: params.to, ...message });
}

export async function sendPasswordChangedEmail(
  params: PasswordChangedEmailParams,
): Promise<SendEmailResult> {
  const message = buildPasswordChangedEmail(params);
  return sendEmail({ to: params.to, ...message });
}
