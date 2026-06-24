import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required.");
}

const PgSession = connectPgSimple(session);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Behind the Replit reverse proxy: trust X-Forwarded-Proto so Secure cookies
// are issued, and use SameSite=None so the session cookie is sent inside the
// cross-site preview iframe.
app.set("trust proxy", 1);
app.use(
  session({
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      tableName: "user_sessions",
    }),
    name: "magazzino.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    // Idle timeout: the session expires 15 minutes after the last request.
    // `rolling` resets that countdown on every request, so active use keeps the
    // session alive while inactivity (no requests) lets it lapse.
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 1000 * 60 * 15,
    },
  }),
);

// CSRF defense: the session cookie is SameSite=None (required for the preview
// iframe), so for state-changing requests we verify the Origin/Referer matches
// one of this deployment's own domains. Browsers always send Origin on
// cross-site mutating requests, so a forged cross-site POST is rejected.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  for (const d of domains) set.add(`https://${d}`);
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) set.add(`https://${dev}`);
  return set;
}

app.use("/api", (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const allow = allowedOrigins();
  // If we cannot determine our own domains, fail open to avoid lockout.
  if (allow.size === 0) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (origin) {
    if (allow.has(origin)) {
      next();
      return;
    }
    res.status(403).json({ error: "Origine non consentita" });
    return;
  }
  const referer = req.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      if (allow.has(`${url.protocol}//${url.host}`)) {
        next();
        return;
      }
    } catch {
      // fall through to rejection
    }
  }
  res.status(403).json({ error: "Origine non consentita" });
});

app.use("/api", router);

export default app;
