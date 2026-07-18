import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  DEFAULT_PASSWORD_RESET_TOKEN_TTL_MINUTES,
  EmailConfigurationError,
  getAppBaseUrl,
  getPasswordResetTokenTtlMinutes,
  sendEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from "../src/lib/emailService";

const ORIGINAL_ENV = { ...process.env };
const MAIL_ENV_KEYS = [
  "MAIL_PROVIDER",
  "MAIL_HOST",
  "MAIL_PORT",
  "MAIL_SECURE",
  "MAIL_USER",
  "MAIL_PASSWORD",
  "MAIL_FROM",
  "MAIL_REPLY_TO",
  "APP_BASE_URL",
  "PASSWORD_RESET_TOKEN_TTL_MINUTES",
] as const;

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  for (const key of MAIL_ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = "test";
}

beforeEach(resetEnv);
afterEach(resetEnv);

describe("emailService", () => {
  it("in test usa la modalità disabled/log-only se SMTP non è configurato", async () => {
    const result = await sendEmail({
      to: "utente@example.org",
      subject: "Messaggio di prova",
      text: "Corpo non sensibile",
    });

    expect(result).toEqual({ sent: false, mode: "disabled" });
  });

  it("valida destinatario e oggetto prima di provare il trasporto", async () => {
    await expect(
      sendEmail({ to: " ", subject: "Oggetto", text: "Test" }),
    ).rejects.toThrow("Destinatario email obbligatorio");
    await expect(
      sendEmail({ to: "utente@example.org", subject: "", text: "Test" }),
    ).rejects.toThrow("Oggetto email obbligatorio");
  });

  it("in production segnala chiaramente la configurazione SMTP mancante", async () => {
    process.env.NODE_ENV = "production";

    await expect(
      sendEmail({ to: "utente@example.org", subject: "Oggetto", text: "Test" }),
    ).rejects.toBeInstanceOf(EmailConfigurationError);
    await expect(
      sendEmail({ to: "utente@example.org", subject: "Oggetto", text: "Test" }),
    ).rejects.toThrow("Configurazione SMTP mancante");
  });

  it("prepara il template recupero password senza generare token", async () => {
    const resetUrl =
      "https://dominio/reset-password?token=token-ricevuto-dal-chiamante";
    const message = buildPasswordResetEmail({
      to: "utente@example.org",
      nome: "Mario",
      resetUrl,
      expiresInMinutes: 60,
    });

    expect(message.subject).toBe("Recupero password Magazzino Solidale");
    expect(message.text).toContain("richiesta di recupero password");
    expect(message.text).toContain(resetUrl);
    expect(message.text).toContain("Il link scade tra 60 minuti.");
    expect(message.text).toContain(
      "Se non hai richiesto tu il recupero password",
    );
    expect(message.html).toContain("Magazzino Solidale");

    const result = await sendPasswordResetEmail({
      to: "utente@example.org",
      username: "mario",
      resetUrl,
      expiresInMinutes: 60,
    });
    expect(result.mode).toBe("disabled");
  });

  it("prepara il template conferma cambio password senza password o token", async () => {
    const message = buildPasswordChangedEmail({
      to: "utente@example.org",
      username: "mario",
    });

    expect(message.subject).toBe("Password modificata - Magazzino Solidale");
    expect(message.text).toContain(
      "password del tuo account Magazzino Solidale è stata modificata correttamente",
    );
    expect(message.text).toContain("contatta subito l'amministratore");
    expect(message.text.toLowerCase()).not.toContain("token");

    const result = await sendPasswordChangedEmail({
      to: "utente@example.org",
      username: "mario",
    });
    expect(result.mode).toBe("disabled");
  });

  it("espone default sicuri per APP_BASE_URL e TTL reset password", () => {
    expect(getAppBaseUrl()).toBe("http://localhost:8080");
    expect(getPasswordResetTokenTtlMinutes()).toBe(
      DEFAULT_PASSWORD_RESET_TOKEN_TTL_MINUTES,
    );

    process.env.APP_BASE_URL = "https://dominio/app/";
    process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES = "480";

    expect(getAppBaseUrl()).toBe("https://dominio/app");
    expect(getPasswordResetTokenTtlMinutes()).toBe(480);
  });
});
