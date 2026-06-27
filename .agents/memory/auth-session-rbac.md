---
name: Auth, sessions & area RBAC
description: Durable decisions for the session-cookie auth + area-based RBAC in Magazzino Solidale (cookie config, CSRF, lockout invariants, session-table bundling).
---

# Session auth + area RBAC

Session-cookie internal auth (express-session + connect-pg-simple), area-based RBAC. Areas: generale/magazzino/sociale/logistica/analisi/amministrazione. Roles carry `aree` + `isAdmin`; admin = all areas.

## Cross-site iframe cookie + CSRF (linked tradeoff)
On Replit the session cookie MUST be `SameSite=None;Secure` with `trust proxy 1` to survive the cross-site preview iframe — a normal `SameSite=Lax/Strict` cookie is dropped there.
**Why:** the preview is a cross-site iframe, so the cookie is third-party.
**How to apply:** because `SameSite=None` re-opens CSRF, pair it with an Origin/Referer allowlist guard for every non-GET/HEAD `/api` request, built from `REPLIT_DOMAINS` + `REPLIT_DEV_DOMAIN`. The two changes are a package — never relax one without the other. Guard falls back to Referer (browsers send it same-origin even when Origin is omitted) and fails open only if no domain env is set. Consequence: server-to-server / curl POSTs must send a matching `Origin` header or get 403.

## Cookie config is env-aware (Replit vs self-host) — do not hardcode Secure
`Secure;SameSite=None` is correct ONLY behind HTTPS. On plain HTTP (self-host on `http://localhost`) the browser silently REJECTS a `Secure` cookie, so login "succeeds" (200 + the FE shows the user from the login response, never re-checking `/auth/me`) yet the cookie never persists → every later mutation is 401 "Non autenticato". Setup/bootstrap still works because it needs no session, which masks the problem.
**How to apply:** `app.ts` auto-detects Replit via `REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN` → `cookieSecure`; else non-Secure + `SameSite=Lax` and `trust proxy false`. Override with `COOKIE_SECURE=true|false`; add self-host CSRF origins via `APP_ORIGINS` (comma-separated full origins). Verify the server itself with curl by sending `-H "X-Forwarded-Proto: https"` (express-session won't emit a Secure cookie otherwise, so a plain-HTTP curl gets NO Set-Cookie even when code is correct).

## connect-pg-simple session table is not auto-created
The library's bundled `table.sql` is NOT included by the esbuild CJS bundle, so `createTableIfMissing:true` fails at runtime.
**How to apply:** define the session table as a normal Drizzle table (`user_sessions`: sid/sess/expire) in the db lib and set `createTableIfMissing:false`. Any other esbuild-bundled server that uses connect-pg-simple needs the same treatment.

## Last-admin lockout has TWO vectors, guard both
A user-level "keep ≥1 active admin" check is insufficient on its own.
**Why:** admin is granted via the *role's* `isAdmin` flag, so demoting the only admin role (`PATCH /ruoli/{id}` isAdmin=false) locks everyone out even when no user row was touched.
**How to apply:** block on both (a) user mutations that would deactivate/demote/delete the last active admin user, and (b) role demotion that would leave zero active admin users (only when that role still has active users). Also block self-delete.

## Defense-in-depth: nav hiding is not the boundary
Frontend hides non-allowed areas via `hasArea`, but the backend `areaGuard` (route-segment → area map) is the real enforcement. Keep the FE area map and BE segment map in sync, but never rely on the FE alone.

## Login hygiene
Regenerate the session id on successful login (`req.session.regenerate`) before setting `userId` to prevent session fixation.

## Idle auto-logout (15 min)
Two layers, intentionally paired:
- Server: `rolling: true` + `cookie.maxAge = 15 min` (app.ts) — each request resets the countdown; inactivity lets the session lapse.
- Client: `src/lib/use-idle-logout.ts` mounted in `App.tsx` AuthGate (enabled while `user`). Resets a 15-min timer on real interaction events; on timeout calls `logout()` + a translated toast.
**Pitfall it solves:** a user typing in a long form makes NO network calls, so the server rolling session would lapse mid-work. The hook therefore fires a throttled keepalive (`refresh()` → refetch `/auth/me`, at most once per 5 min while active) to keep the server session alive during active use. If you change the server maxAge, keep keepAliveMs comfortably below it.
**Cross-tab pitfall:** timers are per-tab but the session is shared, so an idle 2nd tab would log out an active 1st tab. Fixed by broadcasting activity through `localStorage` (key `ms-last-activity`): every tab resets its timer on the `storage` event, and the timeout handler re-checks the shared timestamp before logging out. Any new "log out everywhere" / per-tab session logic must respect this shared-activity invariant.

## Forced password change is a BACKEND boundary
`mustChangePassword` is enforced server-side by `requirePasswordChange` (mounted right after `requireAuth` in routes/index.ts), not just by the FE ChangePassword screen. While the flag is true it 403s every protected route, allowing only `/auth/me`, `/auth/change-password`, `/auth/logout`.
**Why:** the seed admin ships with a known bootstrap credential (set by `lib/seedAdmin.ts`) + `mustChangePassword=true`; FE-only gating let a scripted client log in and call business APIs without ever rotating it. Frontend gating is UX; the middleware is the real boundary. Keep the allowlist in sync if auth self-service routes change.
