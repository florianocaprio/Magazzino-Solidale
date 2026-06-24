---
name: Auth, sessions & area RBAC
description: Durable decisions for the session-cookie auth + area-based RBAC in Magazzino Solidale (cookie config, CSRF, lockout invariants, session-table bundling).
---

# Session auth + area RBAC

Session-cookie internal auth (express-session + connect-pg-simple), area-based RBAC. Areas: generale/magazzino/sociale/logistica/analisi/amministrazione. Roles carry `aree` + `isAdmin`; admin = all areas.

## Cross-site iframe cookie + CSRF (linked tradeoff)
The session cookie MUST be `SameSite=None;Secure` with `trust proxy 1` to survive the cross-site Replit preview iframe — a normal `SameSite=Lax/Strict` cookie is dropped there.
**Why:** the preview is a cross-site iframe, so the cookie is third-party.
**How to apply:** because `SameSite=None` re-opens CSRF, pair it with an Origin/Referer allowlist guard for every non-GET/HEAD `/api` request, built from `REPLIT_DOMAINS` + `REPLIT_DEV_DOMAIN`. The two changes are a package — never relax one without the other. Guard falls back to Referer (browsers send it same-origin even when Origin is omitted) and fails open only if no domain env is set. Consequence: server-to-server / curl POSTs must send a matching `Origin` header or get 403.

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
