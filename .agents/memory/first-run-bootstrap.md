---
name: First-run bootstrap (no seeded admin)
description: How the app boots with zero users and the open setup surface, and why the auth allowlist is exact-path
---

# First-run bootstrap

No default admin user is seeded. Only roles are seeded at startup (Amministratore + Operatore UDS). The app is in "bootstrap mode" exactly when no user is linked to a role with `isAdmin=true` (`isBootstrapMode()` joins utenti→ruoli). A public `GET /auth/bootstrap-status` exposes it; the frontend AuthGate shows the Setup page instead of Login while bootstrap is true, and flips to Login the moment the first admin is created.

## The auth allowlist must be exact-path, not segment-based
During bootstrap an unauthenticated visitor gets a synthetic admin (`BOOTSTRAP_ADMIN`) but ONLY for the minimal setup surface: `GET /utenti`, `GET /ruoli`, `POST /utenti`. It is gated by `isBootstrapAllowedRequest(method, path)` which matches **exact normalized paths** — NOT first-segment. A segment-based check leaks `GET /utenti/:id` and `GET /ruoli/:id`.

**Why:** the open setup surface is unauthenticated; a broad whitelist would expose full admin CRUD / single-record reads on a fresh install.
**How to apply:** if the Setup screen ever needs another endpoint, add its exact path here; never widen to a whole segment.

## requireAuth runs twice — it short-circuits on req.user
`requireAuth` is applied globally (routes/index.ts, sees the full path e.g. `/utenti`) AND again inside the admin routers via `router.use("/utenti", requireAuth, requireAdmin)`. The inner `router.use(prefix, ...)` STRIPS the prefix, so the inner pass sees `req.path === "/"` and could never authorize a bootstrap request. Fix: `requireAuth` returns early if `req.user` is already set (only ever assigned inside requireAuth — no untrusted source), making the inner pass idempotent. The real bootstrap boundary is therefore the GLOBAL pass which sees the full path.

## First access is intentionally frictionless
By deliberate user request, the first access must be immediate:
- New users created via `POST /utenti` are persisted with `mustChangePassword: false` (NOT true). Once created, a user logs in straight into the app — no forced password change. (The forced-change machinery — `requirePasswordChange` middleware + frontend routing on `user.mustChangePassword` — still exists and is still set by admin reset-password, just not on creation.)
- `POST /auth/change-password` does NOT verify (or accept) the old/current password. Behind `requireAuth`, an authenticated session sets a new password if it is ≥8 chars (confirm-match is client-side only). `ChangePasswordInput` requires only `newPassword` (minLength 8); no `currentPassword` field exists in the contract.
**Why:** the user explicitly wanted the simplest possible onboarding. Do not "restore" a forced-change-on-create or a current-password check thinking they're missing guards.
