export type SessionSameSite = "lax" | "strict" | "none";

export type SessionRuntimeConfig = {
  cookieSecure: boolean;
  cookieSameSite: SessionSameSite;
  trustProxy: false | 1;
  allowedOrigins: Set<string>;
};

function parseBooleanEnv(
  name: string,
  value: string | undefined,
): boolean | undefined {
  if (value == null || value.trim() === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

function parseSameSite(value: string | undefined): SessionSameSite | undefined {
  if (value == null || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "lax" ||
    normalized === "strict" ||
    normalized === "none"
  ) {
    return normalized;
  }
  throw new Error('COOKIE_SAMESITE must be one of "lax", "strict" or "none".');
}

function collectAllowedOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const origins = new Set<string>();
  const domains = (env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
  for (const domain of domains) origins.add(`https://${domain}`);

  const devDomain = env.REPLIT_DEV_DOMAIN?.trim();
  if (devDomain) origins.add(`https://${devDomain}`);

  const extraOrigins = (env.APP_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of extraOrigins) origins.add(origin);

  return origins;
}

/**
 * Resolves session-cookie and origin settings once at startup.
 *
 * Explicit COOKIE_SECURE / COOKIE_SAMESITE values always win. This is
 * important for self-hosted deployments where inherited Replit variables may
 * otherwise produce a Secure cookie on plain HTTP and every protected request
 * would then look unauthenticated.
 */
export function resolveSessionRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): SessionRuntimeConfig {
  const onReplit = Boolean(env.REPLIT_DOMAINS || env.REPLIT_DEV_DOMAIN);
  const cookieSecure =
    parseBooleanEnv("COOKIE_SECURE", env.COOKIE_SECURE) ?? onReplit;
  const cookieSameSite =
    parseSameSite(env.COOKIE_SAMESITE) ?? (cookieSecure ? "none" : "lax");

  if (cookieSameSite === "none" && !cookieSecure) {
    throw new Error(
      "COOKIE_SAMESITE=none richiede COOKIE_SECURE=true; usare lax per HTTP.",
    );
  }

  return {
    cookieSecure,
    cookieSameSite,
    trustProxy: cookieSecure ? 1 : false,
    allowedOrigins: collectAllowedOrigins(env),
  };
}
