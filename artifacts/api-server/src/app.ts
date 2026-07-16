import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveSessionRuntimeConfig } from "./lib/sessionConfig";

const app: Express = express();

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required.");
}

const PgSession = connectPgSimple(session);
const sessionConfig = resolveSessionRuntimeConfig();

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
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Requests without Origin include same-origin server calls, curl and
      // health probes. Cross-origin browser calls are allowed only when the
      // deployment explicitly lists their origin.
      if (!origin || sessionConfig.allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(process.env.UPLOAD_DIR ?? "/app/uploads", {
  fallthrough: false,
  index: false,
  maxAge: "1d",
}));

// Session cookie / proxy configuration adapts to the runtime environment:
// - On Replit the app is served over HTTPS behind a reverse proxy and rendered
//   inside a cross-site preview iframe, so the cookie must be Secure +
//   SameSite=None and we must trust the proxy's X-Forwarded-Proto header.
// - When self-hosted over plain HTTP (e.g. http://localhost:8082) a Secure /
//   SameSite=None cookie is rejected by the browser, so the session would never
//   persist and every request looks unauthenticated. In that case fall back to
//   a non-Secure, SameSite=Lax cookie (works fine for same-origin self-hosting).
// Override the auto-detection with COOKIE_SECURE=true|false (e.g. set it to
// "true" when self-hosting behind your own HTTPS reverse proxy).
const { cookieSecure, cookieSameSite } = sessionConfig;

app.set("trust proxy", sessionConfig.trustProxy);
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
    proxy: cookieSecure,
    // Idle timeout: the session expires 15 minutes after the last request.
    // `rolling` resets that countdown on every request, so active use keeps the
    // session alive while inactivity (no requests) lets it lapse.
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      maxAge: 1000 * 60 * 15,
    },
  }),
);

// CSRF defense: the session cookie is SameSite=None (required for the preview
// iframe), so for state-changing requests we verify the Origin/Referer matches
// one of this deployment's own domains. Browsers always send Origin on
// cross-site mutating requests, so a forged cross-site POST is rejected.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

app.use("/api", (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const allow = sessionConfig.allowedOrigins;
  if (allow.size === 0) {
    // No allowlist configured. Failing open is only safe when the session
    // cookie is SameSite=Lax (the browser already refuses to send it on
    // cross-site mutating requests). With a SameSite=None cookie an empty
    // allowlist would leave mutations CSRF-exposed, so reject instead — set
    // APP_ORIGINS (or REPLIT_DOMAINS) to allow them.
    if (cookieSameSite !== "none") {
      next();
      return;
    }
    res.status(403).json({ error: "Origine non consentita" });
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
